// ============================================================
//  bobyak 🍚  — 앱 로직 (모임별 링크 버전)
//  - URL에 ?g=<모임ID> 없으면 → '모임 만들기' 화면
//  - 있으면 → 그 모임의 달력 화면
//  - 저장소: Supabase(공유/실시간) 또는 localStorage(로컬 폴백)
// ============================================================

(() => {
  const cfg = window.BOBYAK_CONFIG;
  const palette = cfg.palette;

  // ---------- 날짜 유틸 (KST 로컬 기준, toISOString 금지!) ----------
  const pad = (n) => String(n).padStart(2, "0");
  function ymd(y, m, d) { return `${y}-${pad(m + 1)}-${pad(d)}`; }
  function todayParts() { const t = new Date(); return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() }; }

  // ---------- 모임 ID 생성 (헷갈리는 문자 제외) ----------
  function genId() {
    const c = "abcdefghijkmnpqrstuvwxyz23456789";
    const arr = new Uint8Array(8);
    (window.crypto && crypto.getRandomValues) ? crypto.getRandomValues(arr)
      : arr.forEach((_, i) => (arr[i] = Math.floor(Math.random() * 256)));
    return Array.from(arr, (b) => c[b % c.length]).join("");
  }

  // 메모리 키
  const ak = (gid, name, date) => `${gid}|${name}|${date}`;

  // =========================================================
  //  저장소 추상화
  // =========================================================

  // ---- 로컬 저장소 ----
  const LocalStore = {
    mode: "로컬",
    GK: "bobyak_groups_v2",
    AK: "bobyak_abs_v2",
    groups: {},
    abs: new Set(),
    async init() {
      try { this.groups = JSON.parse(localStorage.getItem(this.GK) || "{}"); } catch { this.groups = {}; }
      try { this.abs = new Set(JSON.parse(localStorage.getItem(this.AK) || "[]")); } catch { this.abs = new Set(); }
    },
    _saveG() { localStorage.setItem(this.GK, JSON.stringify(this.groups)); },
    _saveA() { localStorage.setItem(this.AK, JSON.stringify([...this.abs])); },
    async createGroup(id, name, members) { this.groups[id] = { name, members }; this._saveG(); },
    async getGroup(id) { return this.groups[id] || null; },
    async setMembers(id, members) { if (this.groups[id]) { this.groups[id].members = members; this._saveG(); } },
    async watchGroup() { /* 로컬은 이미 메모리에 다 있음 */ },
    has(gid, name, date) { return this.abs.has(ak(gid, name, date)); },
    async toggle(gid, name, date) {
      const k = ak(gid, name, date);
      this.abs.has(k) ? this.abs.delete(k) : this.abs.add(k);
      this._saveA();
    },
  };

  // ---- Supabase 라이브러리 동적 로딩 ----
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
    abs: new Set(),
    _cb: null,
    async init() {
      await loadSupabaseLib();
      this.client = supabase.createClient(cfg.supabase.url, cfg.supabase.anonKey);
    },
    async createGroup(id, name, members) {
      const { error } = await this.client.from("groups").insert({ id, name, members });
      if (error) throw error;
    },
    async getGroup(id) {
      const { data, error } = await this.client.from("groups")
        .select("name,members").eq("id", id).maybeSingle();
      if (error) throw error;
      return data ? { name: data.name, members: data.members } : null;
    },
    async setMembers(id, members) {
      const { error } = await this.client.from("groups").update({ members }).eq("id", id);
      if (error) throw error;
    },
    async watchGroup(gid, onChange) {
      this._cb = onChange;
      const { data, error } = await this.client.from("absences")
        .select("member,date").eq("group_id", gid);
      if (error) throw error;
      this.abs = new Set(data.map((r) => ak(gid, r.member, r.date)));
      this.client
        .channel("abs-" + gid)
        .on("postgres_changes",
          { event: "*", schema: "public", table: "absences", filter: `group_id=eq.${gid}` },
          (p) => {
            if (p.eventType === "INSERT") this.abs.add(ak(gid, p.new.member, p.new.date));
            if (p.eventType === "DELETE") this.abs.delete(ak(gid, p.old.member, p.old.date));
            this._cb && this._cb();
          })
        .subscribe();
    },
    has(gid, name, date) { return this.abs.has(ak(gid, name, date)); },
    async toggle(gid, name, date) {
      const k = ak(gid, name, date);
      if (this.abs.has(k)) {
        this.abs.delete(k);
        const { error } = await this.client.from("absences")
          .delete().eq("group_id", gid).eq("member", name).eq("date", date);
        if (error) { this.abs.add(k); throw error; }
      } else {
        this.abs.add(k);
        const { error } = await this.client.from("absences")
          .insert({ group_id: gid, member: name, date });
        if (error) { this.abs.delete(k); throw error; }
      }
    },
  };

  const useShared = !!(cfg.supabase && cfg.supabase.url && cfg.supabase.anonKey);
  const store = useShared ? SupaStore : LocalStore;

  // =========================================================
  //  공통 DOM / 유틸
  // =========================================================
  const $ = (id) => document.getElementById(id);
  const toastEl = $("toast");
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1800);
  }

  // 최근 본 모임 (로컬 편의 기능)
  const RECENT = "bobyak_recent";
  function pushRecent(id, name) {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(RECENT) || "[]"); } catch {}
    list = list.filter((x) => x.id !== id);
    list.unshift({ id, name });
    localStorage.setItem(RECENT, JSON.stringify(list.slice(0, 6)));
  }
  function getRecent() {
    try { return JSON.parse(localStorage.getItem(RECENT) || "[]"); } catch { return []; }
  }

  function setMode(text) { $("storageMode").textContent = `· ${text} ·`; }

  // =========================================================
  //  화면 A — 모임 만들기
  // =========================================================
  function renderCreate() {
    $("screenCreate").classList.remove("hidden");
    $("screenView").classList.add("hidden");
    $("subtitle").textContent = "밥 먹고 합시다!";

    const newMembers = []; // [{name,color}]
    const chipsEl = $("newMemberChips");
    const nameInput = $("memberNameInput");

    function renderChips() {
      chipsEl.innerHTML = "";
      newMembers.forEach((m, i) => {
        const b = document.createElement("span");
        b.className = "chip";
        b.style.setProperty("--c", m.color);
        b.innerHTML = `<span class="dot" style="background:${m.color}"></span>${m.name}<span class="x">✕</span>`;
        b.querySelector(".x").onclick = () => { newMembers.splice(i, 1); renderChips(); };
        chipsEl.appendChild(b);
      });
    }
    function addMember() {
      const name = nameInput.value.trim();
      if (!name) return;
      if (newMembers.some((m) => m.name === name)) { toast("이미 있는 이름이에요"); return; }
      newMembers.push({ name, color: palette[newMembers.length % palette.length] });
      nameInput.value = "";
      nameInput.focus();
      renderChips();
    }
    $("addMemberBtn").onclick = addMember;
    nameInput.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); addMember(); } };

    $("createBtn").onclick = async () => {
      const name = $("groupNameInput").value.trim();
      if (!name) { toast("모임 이름을 입력해줘요"); return; }
      if (newMembers.length === 0) { toast("멤버를 한 명 이상 추가해줘요"); return; }
      const id = genId();
      try {
        await store.createGroup(id, name, newMembers);
        pushRecent(id, name);
        location.href = `./?g=${id}`; // 새로고침 → 달력 화면으로
      } catch (e) {
        console.error(e);
        toast("모임 생성 실패 😢 (Supabase 연결 확인)");
      }
    };

    // 최근 본 모임
    const recent = getRecent();
    if (recent.length) {
      $("recentCard").classList.remove("hidden");
      const list = $("recentList");
      list.innerHTML = "";
      recent.forEach((r) => {
        const a = document.createElement("a");
        a.className = "recent-item";
        a.href = `./?g=${r.id}`;
        a.innerHTML = `<span>${r.name}</span><span class="go">열기 ›</span>`;
        list.appendChild(a);
      });
    }
  }

  // =========================================================
  //  화면 B — 모임 달력
  // =========================================================
  function renderView(gid, group) {
    $("screenCreate").classList.add("hidden");
    $("screenView").classList.remove("hidden");
    $("subtitle").textContent = group.name;
    document.title = `${group.name} · bobyak`;

    const members = group.members;
    const memberByName = Object.fromEntries(members.map((m) => [m.name, m]));
    const t = todayParts();
    let viewY = t.y, viewM = t.m;

    const MEKEY = `bobyak_me_${gid}`;
    let me = localStorage.getItem(MEKEY);
    if (me && !memberByName[me]) me = null;

    const chipsEl = $("memberChips");
    const daysEl = $("daysGrid");
    const legendEl = $("legend");
    const calEl = document.querySelector(".calendar");

    // 링크 복사
    $("copyLinkBtn").onclick = async () => {
      const url = location.href;
      try {
        await navigator.clipboard.writeText(url);
        toast("링크 복사 완료! 단톡방에 붙여넣기 📋");
      } catch {
        const ta = document.createElement("textarea");
        ta.value = url; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); toast("링크 복사 완료! 📋"); }
        catch { toast("복사 실패 — 주소창 링크를 직접 공유해줘요"); }
        document.body.removeChild(ta);
      }
    };

    // 멤버 추가 (모임 만든 뒤에도)
    $("addMemberView").onclick = async () => {
      const name = (prompt("추가할 멤버 이름은?") || "").trim();
      if (!name) return;
      if (memberByName[name]) { toast("이미 있는 멤버예요"); return; }
      const color = palette[members.length % palette.length];
      members.push({ name, color });
      memberByName[name] = { name, color };
      try {
        await store.setMembers(gid, members);
        renderChips(); renderLegend(); renderDays();
        toast(`${name} 추가 완료!`);
      } catch (e) {
        console.error(e);
        members.pop(); delete memberByName[name];
        toast("멤버 추가 실패 😢");
      }
    };

    function renderChips() {
      chipsEl.innerHTML = "";
      members.forEach((m) => {
        const b = document.createElement("button");
        b.className = "chip" + (me === m.name ? " selected" : "");
        b.style.setProperty("--c", m.color);
        b.innerHTML = `<span class="dot" style="background:${m.color}"></span>${m.name}`;
        b.onclick = () => {
          me = (me === m.name) ? null : m.name;
          me ? localStorage.setItem(MEKEY, me) : localStorage.removeItem(MEKEY);
          renderChips(); renderDays();
          if (me) toast(`${m.name}(으)로 설정했어요!`);
        };
        chipsEl.appendChild(b);
      });
    }

    function renderLegend() {
      legendEl.innerHTML = "";
      members.forEach((m) => {
        const s = document.createElement("span");
        s.className = "legend-item";
        s.innerHTML = `<span class="dot" style="background:${m.color}"></span>${m.name}`;
        legendEl.appendChild(s);
      });
    }

    function renderDays() {
      $("calTitle").textContent = `${viewY}년 ${viewM + 1}월`;
      calEl.classList.toggle("locked", !me);
      daysEl.innerHTML = "";

      const first = new Date(viewY, viewM, 1).getDay();
      const last = new Date(viewY, viewM + 1, 0).getDate();
      const myColor = me ? memberByName[me].color : null;

      for (let i = 0; i < first; i++) {
        const e = document.createElement("div");
        e.className = "day empty";
        daysEl.appendChild(e);
      }
      for (let d = 1; d <= last; d++) {
        const date = ymd(viewY, viewM, d);
        const dow = new Date(viewY, viewM, d).getDay();
        const cell = document.createElement("div");
        cell.className = "day";
        if (dow === 0) cell.classList.add("sun");
        if (dow === 6) cell.classList.add("sat");
        if (viewY === t.y && viewM === t.m && d === t.d) cell.classList.add("today");

        const absent = members.filter((m) => store.has(gid, m.name, date));
        if (me && store.has(gid, me, date)) {
          cell.classList.add("mine");
          cell.style.setProperty("--myc", myColor);
        }
        const dots = absent
          .map((m) => `<span class="pdot" style="background:${m.color}" title="${m.name}"></span>`)
          .join("");
        cell.innerHTML = `<span class="num">${d}</span><div class="dots">${dots}</div>`;
        cell.onclick = () => onDayClick(date);
        daysEl.appendChild(cell);
      }
    }

    async function onDayClick(date) {
      if (!me) { toast("먼저 위에서 이름을 골라줘요!"); return; }
      const wasAbsent = store.has(gid, me, date);
      try {
        await store.toggle(gid, me, date);
        renderDays();
        toast(wasAbsent ? `${date} 부재 취소` : `${date} 부재 표시 ✓`);
      } catch (e) {
        console.error(e);
        toast("저장 실패 😢 다시 시도해줘요");
      }
    }

    $("prevBtn").onclick = () => { if (--viewM < 0) { viewM = 11; viewY--; } renderDays(); };
    $("nextBtn").onclick = () => { if (++viewM > 11) { viewM = 0; viewY++; } renderDays(); };
    $("todayBtn").onclick = () => { viewY = t.y; viewM = t.m; renderDays(); };

    renderChips();
    renderLegend();
    renderDays();

    // 부재 데이터 로드 + 실시간 구독
    store.watchGroup(gid, () => renderDays())
      .then(() => renderDays())
      .catch((e) => { console.error(e); toast("부재 데이터 로드 실패 😢"); });

    pushRecent(gid, group.name);
  }

  // =========================================================
  //  시작 — 라우팅
  // =========================================================
  async function main() {
    try {
      await store.init();
      setMode(store.mode === "공유" ? "공유 모드" : "로컬 모드");
    } catch (e) {
      console.error("저장소 초기화 실패:", e);
      setMode("연결 오류");
      toast("공유 저장소 연결 실패 😢");
      // 그래도 화면은 띄움 (만들기 화면)
      renderCreate();
      return;
    }

    const gid = new URLSearchParams(location.search).get("g");
    if (!gid) { renderCreate(); return; }

    try {
      const group = await store.getGroup(gid);
      if (!group) {
        toast("모임을 찾을 수 없어요. 새로 만들어볼까요?");
        history.replaceState(null, "", "./");
        renderCreate();
        return;
      }
      renderView(gid, group);
    } catch (e) {
      console.error(e);
      toast("모임 불러오기 실패 😢");
      renderCreate();
    }
  }

  main();
})();
