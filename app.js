// ============================================================
//  bobyak 🍚  — 앱 로직
//  - 멤버 선택 → 달력 날짜 탭 → 내 색깔로 부재 표시 토글
//  - 저장소: Supabase(공유) 또는 localStorage(로컬) 자동 선택
// ============================================================

(() => {
  const cfg = window.BOBYAK_CONFIG;
  const members = cfg.members;
  const memberByName = Object.fromEntries(members.map((m) => [m.name, m]));

  // ---------- 날짜 유틸 (KST 로컬 기준, toISOString 금지!) ----------
  function ymd(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  function todayParts() {
    const t = new Date();
    return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
  }

  // =========================================================
  //  저장소 추상화
  //  데이터 모양: Set of "name|YYYY-MM-DD"
  // =========================================================
  function key(name, date) { return `${name}|${date}`; }

  // ---- 로컬 저장소 ----
  const LocalStore = {
    mode: "로컬",
    _LS: "bobyak_absences_v1",
    data: new Set(),
    async init() {
      try {
        const raw = JSON.parse(localStorage.getItem(this._LS) || "[]");
        this.data = new Set(raw);
      } catch { this.data = new Set(); }
    },
    _save() { localStorage.setItem(this._LS, JSON.stringify([...this.data])); },
    has(name, date) { return this.data.has(key(name, date)); },
    async toggle(name, date) {
      const k = key(name, date);
      if (this.data.has(k)) this.data.delete(k); else this.data.add(k);
      this._save();
    },
    onChange() { /* 로컬은 실시간 없음 */ },
  };

  // Supabase 라이브러리를 필요할 때만 동적으로 로딩 (오프라인/로컬 모드에선 아예 안 부름)
  function loadSupabaseLib() {
    return new Promise((resolve, reject) => {
      if (window.supabase) return resolve();
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Supabase 라이브러리 로드 실패 (네트워크 확인)"));
      document.head.appendChild(s);
    });
  }

  // ---- Supabase 저장소 ----
  const SupaStore = {
    mode: "공유",
    client: null,
    data: new Set(),
    _cb: null,
    async init() {
      await loadSupabaseLib();
      this.client = supabase.createClient(cfg.supabase.url, cfg.supabase.anonKey);
      const { data, error } = await this.client.from("absences").select("member,date");
      if (error) throw error;
      this.data = new Set(data.map((r) => key(r.member, r.date)));
      // 실시간 구독
      this.client
        .channel("absences-rt")
        .on("postgres_changes", { event: "*", schema: "public", table: "absences" }, (p) => {
          if (p.eventType === "INSERT") this.data.add(key(p.new.member, p.new.date));
          if (p.eventType === "DELETE") this.data.delete(key(p.old.member, p.old.date));
          this._cb && this._cb();
        })
        .subscribe();
    },
    has(name, date) { return this.data.has(key(name, date)); },
    async toggle(name, date) {
      const k = key(name, date);
      if (this.data.has(k)) {
        this.data.delete(k); // 낙관적 갱신
        const { error } = await this.client.from("absences")
          .delete().eq("member", name).eq("date", date);
        if (error) { this.data.add(k); throw error; }
      } else {
        this.data.add(k);
        const { error } = await this.client.from("absences")
          .insert({ member: name, date });
        if (error) { this.data.delete(k); throw error; }
      }
    },
    onChange(cb) { this._cb = cb; },
  };

  const useShared = !!(cfg.supabase && cfg.supabase.url && cfg.supabase.anonKey);
  const store = useShared ? SupaStore : LocalStore;

  // =========================================================
  //  상태
  // =========================================================
  const t = todayParts();
  let viewY = t.y, viewM = t.m;
  let me = localStorage.getItem("bobyak_me") || null;
  if (me && !memberByName[me]) me = null;

  // =========================================================
  //  DOM
  // =========================================================
  const $ = (id) => document.getElementById(id);
  const els = {
    groupName: $("groupName"), chips: $("memberChips"),
    calTitle: $("calTitle"), days: $("daysGrid"),
    legend: $("legend"), prev: $("prevBtn"), next: $("nextBtn"),
    today: $("todayBtn"), calendar: document.querySelector(".calendar"),
    mode: $("storageMode"), toast: $("toast"),
  };

  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 1600);
  }

  // ---------- 렌더: 멤버 칩 ----------
  function renderChips() {
    els.chips.innerHTML = "";
    members.forEach((m) => {
      const b = document.createElement("button");
      b.className = "chip" + (me === m.name ? " selected" : "");
      b.style.setProperty("--c", m.color);
      b.innerHTML = `<span class="dot" style="background:${m.color}"></span>${m.name}`;
      b.onclick = () => {
        me = (me === m.name) ? null : m.name;
        if (me) localStorage.setItem("bobyak_me", me);
        else localStorage.removeItem("bobyak_me");
        renderChips();
        renderDays();
        if (me) toast(`${m.name}(으)로 설정했어요!`);
      };
      els.chips.appendChild(b);
    });
  }

  // ---------- 렌더: 범례 ----------
  function renderLegend() {
    els.legend.innerHTML = "";
    members.forEach((m) => {
      const s = document.createElement("span");
      s.className = "legend-item";
      s.innerHTML = `<span class="dot" style="background:${m.color}"></span>${m.name}`;
      els.legend.appendChild(s);
    });
  }

  // ---------- 렌더: 달력 ----------
  function renderDays() {
    els.calTitle.textContent = `${viewY}년 ${viewM + 1}월`;
    els.calendar.classList.toggle("locked", !me);
    els.days.innerHTML = "";

    const first = new Date(viewY, viewM, 1).getDay(); // 0=일
    const last = new Date(viewY, viewM + 1, 0).getDate();
    const myColor = me ? memberByName[me].color : null;

    for (let i = 0; i < first; i++) {
      const e = document.createElement("div");
      e.className = "day empty";
      els.days.appendChild(e);
    }

    for (let d = 1; d <= last; d++) {
      const date = ymd(viewY, viewM, d);
      const dow = new Date(viewY, viewM, d).getDay();
      const cell = document.createElement("div");
      cell.className = "day";
      if (dow === 0) cell.classList.add("sun");
      if (dow === 6) cell.classList.add("sat");
      if (viewY === t.y && viewM === t.m && d === t.d) cell.classList.add("today");

      const absent = members.filter((m) => store.has(m.name, date));
      if (me && store.has(me, date)) {
        cell.classList.add("mine");
        cell.style.setProperty("--myc", myColor);
      }

      const dots = absent
        .map((m) => `<span class="pdot" style="background:${m.color}" title="${m.name}"></span>`)
        .join("");
      cell.innerHTML = `<span class="num">${d}</span><div class="dots">${dots}</div>`;

      cell.onclick = () => onDayClick(date);
      els.days.appendChild(cell);
    }
  }

  async function onDayClick(date) {
    if (!me) { toast("먼저 위에서 이름을 골라줘요!"); return; }
    const wasAbsent = store.has(me, date);
    try {
      await store.toggle(me, date);
      renderDays();
      toast(wasAbsent ? `${date} 부재 취소` : `${date} 부재 표시 ✓`);
    } catch (e) {
      console.error(e);
      toast("저장 실패 😢 다시 시도해줘요");
    }
  }

  // ---------- 네비게이션 ----------
  function go(delta) {
    viewM += delta;
    if (viewM < 0) { viewM = 11; viewY--; }
    if (viewM > 11) { viewM = 0; viewY++; }
    renderDays();
  }
  els.prev.onclick = () => go(-1);
  els.next.onclick = () => go(1);
  els.today.onclick = () => { viewY = t.y; viewM = t.m; renderDays(); };

  // =========================================================
  //  시작
  // =========================================================
  async function start() {
    els.groupName.textContent = cfg.groupName || "밥약 달력";
    renderChips();
    renderLegend();
    renderDays();

    try {
      await store.init();
      els.mode.textContent = `· ${store.mode} 모드 ·`;
      store.onChange(() => renderDays());
      renderDays();
    } catch (e) {
      console.error("저장소 초기화 실패:", e);
      els.mode.textContent = "· 연결 오류 (로컬로 동작) ·";
      toast("공유 저장소 연결 실패 😢");
    }
  }

  start();
})();
