// ============================================================
//  bobyak 🍚  — 앱 로직 (모임별 링크 버전)
//  - URL에 ?g=<모임ID> 없으면 → '모임 만들기' 화면
//  - 있으면 → 그 모임의 달력 화면
//  - 저장소: Supabase(공유/실시간) 또는 localStorage(로컬 폴백)
// ============================================================

(() => {
  const cfg = window.BOBYAK_CONFIG;
  const palette = cfg.palette;
  const MAX_MEMBERS = 10; // 모임 최대 인원

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
    MKEY: "bobyak_marks_v3",
    groups: {},
    marks: {}, // key -> 'full' | 'am' | 'pm'
    async init() {
      try { this.groups = JSON.parse(localStorage.getItem(this.GK) || "{}"); } catch { this.groups = {}; }
      try { this.marks = JSON.parse(localStorage.getItem(this.MKEY) || "{}"); } catch { this.marks = {}; }
    },
    _saveG() { localStorage.setItem(this.GK, JSON.stringify(this.groups)); },
    _saveM() { localStorage.setItem(this.MKEY, JSON.stringify(this.marks)); },
    async createGroup(id, name, members) { this.groups[id] = { name, members }; this._saveG(); },
    async getGroup(id) { return this.groups[id] || null; },
    async setMembers(id, members) { if (this.groups[id]) { this.groups[id].members = members; this._saveG(); } },
    async watchGroup() { /* 로컬은 이미 메모리에 다 있음 */ },
    get(gid, name, date) { return this.marks[ak(gid, name, date)] || null; },
    async setStatus(gid, name, date, status) {
      const k = ak(gid, name, date);
      if (status) this.marks[k] = status; else delete this.marks[k];
      this._saveM();
    },
    async renameMember(gid, oldN, newN) {
      const pre = `${gid}|${oldN}|`;
      Object.keys(this.marks).forEach((k) => {
        if (k.startsWith(pre)) { this.marks[`${gid}|${newN}|${k.slice(pre.length)}`] = this.marks[k]; delete this.marks[k]; }
      });
      this._saveM();
    },
    async deleteMemberData(gid, name) {
      const pre = `${gid}|${name}|`;
      Object.keys(this.marks).forEach((k) => { if (k.startsWith(pre)) delete this.marks[k]; });
      this._saveM();
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
    marks: {}, // key -> 'full' | 'am' | 'pm'
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
        .select("member,date,status").eq("group_id", gid);
      if (error) throw error;
      this.marks = {};
      data.forEach((r) => { this.marks[ak(gid, r.member, r.date)] = r.status || "full"; });
      this.client
        .channel("abs-" + gid)
        .on("postgres_changes",
          { event: "*", schema: "public", table: "absences", filter: `group_id=eq.${gid}` },
          (p) => {
            if (p.eventType === "DELETE") delete this.marks[ak(gid, p.old.member, p.old.date)];
            else this.marks[ak(gid, p.new.member, p.new.date)] = p.new.status || "full";
            this._cb && this._cb();
          })
        .subscribe();
    },
    get(gid, name, date) { return this.marks[ak(gid, name, date)] || null; },
    async setStatus(gid, name, date, status) {
      const k = ak(gid, name, date);
      const prev = this.marks[k] || null;
      if (status) {
        this.marks[k] = status;
        const { error } = await this.client.from("absences")
          .upsert({ group_id: gid, member: name, date, status }, { onConflict: "group_id,member,date" });
        if (error) { prev ? (this.marks[k] = prev) : delete this.marks[k]; throw error; }
      } else {
        delete this.marks[k];
        const { error } = await this.client.from("absences")
          .delete().eq("group_id", gid).eq("member", name).eq("date", date);
        if (error) { if (prev) this.marks[k] = prev; throw error; }
      }
    },
    async renameMember(gid, oldN, newN) {
      const { error } = await this.client.from("absences")
        .update({ member: newN }).eq("group_id", gid).eq("member", oldN);
      if (error) throw error;
      const pre = `${gid}|${oldN}|`;
      Object.keys(this.marks).forEach((k) => {
        if (k.startsWith(pre)) { this.marks[`${gid}|${newN}|${k.slice(pre.length)}`] = this.marks[k]; delete this.marks[k]; }
      });
    },
    async deleteMemberData(gid, name) {
      const { error } = await this.client.from("absences")
        .delete().eq("group_id", gid).eq("member", name);
      if (error) throw error;
      const pre = `${gid}|${name}|`;
      Object.keys(this.marks).forEach((k) => { if (k.startsWith(pre)) delete this.marks[k]; });
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
      if (newMembers.length >= MAX_MEMBERS) { toast(`최대 ${MAX_MEMBERS}명까지예요`); return; }
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
    function startOfWeek(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - x.getDay()); return x; }
    function addDays(d, n) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
    let weekStart = startOfWeek(new Date()); // 보고 있는 주의 일요일

    const MEKEY = `bobyak_me_${gid}`;
    let me = localStorage.getItem(MEKEY);
    if (me && !memberByName[me]) me = null;
    let editMode = false;

    const chipsEl = $("memberChips");
    const daysEl = $("daysGrid");
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
      if (members.length >= MAX_MEMBERS) { toast(`최대 ${MAX_MEMBERS}명까지예요`); return; }
      const name = (prompt("추가할 멤버 이름은?") || "").trim();
      if (!name) return;
      if (memberByName[name]) { toast("이미 있는 멤버예요"); return; }
      const color = palette[members.length % palette.length];
      members.push({ name, color });
      memberByName[name] = { name, color };
      try {
        await store.setMembers(gid, members);
        renderChips(); renderDays();
        toast(`${name} 추가 완료!`);
      } catch (e) {
        console.error(e);
        members.pop(); delete memberByName[name];
        toast("멤버 추가 실패 😢");
      }
    };

    // 이름 수정 모드 토글
    $("editMembers").onclick = () => {
      editMode = !editMode;
      $("editMembers").textContent = editMode ? "✓ 완료" : "✏️ 수정";
      $("editMembers").classList.toggle("active", editMode);
      renderChips();
    };

    function selectMe(name) {
      me = (me === name) ? null : name;
      me ? localStorage.setItem(MEKEY, me) : localStorage.removeItem(MEKEY);
      renderChips(); renderDays();
      if (me) toast(`${name}(으)로 설정했어요!`);
    }

    async function renameMember(m) {
      const newName = (prompt("새 이름은?", m.name) || "").trim();
      if (!newName || newName === m.name) return;
      if (memberByName[newName]) { toast("이미 있는 이름이에요"); return; }
      const oldName = m.name;
      m.name = newName;
      delete memberByName[oldName]; memberByName[newName] = m;
      try {
        await store.setMembers(gid, members);
        await store.renameMember(gid, oldName, newName);
        if (me === oldName) { me = newName; localStorage.setItem(MEKEY, me); }
        renderChips(); renderDays();
        toast(`${oldName} → ${newName} ✓`);
      } catch (e) {
        console.error(e);
        m.name = oldName; delete memberByName[newName]; memberByName[oldName] = m;
        renderChips();
        toast("이름 변경 실패 😢");
      }
    }

    async function deleteMember(m, idx) {
      if (!confirm(`'${m.name}' 멤버를 삭제할까요?\n표시한 날짜도 같이 지워져요.`)) return;
      const removed = members[idx];
      members.splice(idx, 1);
      delete memberByName[m.name];
      try {
        await store.setMembers(gid, members);
        await store.deleteMemberData(gid, m.name);
        if (me === m.name) { me = null; localStorage.removeItem(MEKEY); }
        renderChips(); renderDays();
        toast(`${m.name} 삭제됨`);
      } catch (e) {
        console.error(e);
        members.splice(idx, 0, removed); memberByName[removed.name] = removed;
        renderChips();
        toast("삭제 실패 😢");
      }
    }

    function renderChips() {
      chipsEl.innerHTML = "";
      members.forEach((m, idx) => {
        const b = document.createElement(editMode ? "span" : "button");
        b.className = "chip" + (!editMode && me === m.name ? " selected" : "") + (editMode ? " editing" : "");
        b.style.setProperty("--c", m.color);
        if (editMode) {
          b.innerHTML = `<span class="dot" style="background:${m.color}"></span>` +
            `<span class="cname">${m.name}</span><span class="x" title="삭제">✕</span>`;
          b.querySelector(".cname").onclick = () => renameMember(m);
          b.querySelector(".x").onclick = () => deleteMember(m, idx);
        } else {
          b.innerHTML = `<span class="dot" style="background:${m.color}"></span>${m.name}`;
          b.onclick = () => selectMe(m.name);
        }
        chipsEl.appendChild(b);
      });
    }


    function renderDays() {
      calEl.classList.toggle("locked", !me);
      daysEl.innerHTML = "";
      const myColor = me ? memberByName[me].color : null;

      // 이번 주 7일 범위 제목
      const s = weekStart, e = addDays(weekStart, 6);
      $("calTitle").textContent =
        `${s.getMonth() + 1}월 ${s.getDate()}일 – ${e.getMonth() + 1}월 ${e.getDate()}일`;

      for (let i = 0; i < 7; i++) {
        const day = addDays(weekStart, i);
        const yy = day.getFullYear(), mm = day.getMonth(), dd = day.getDate();
        const date = ymd(yy, mm, dd);
        const dow = day.getDay();
        const cell = document.createElement("div");
        cell.className = "day";
        if (dow === 0) cell.classList.add("sun");
        if (dow === 6) cell.classList.add("sat");
        if (yy === t.y && mm === t.m && dd === t.d) cell.classList.add("today");

        const myStatus = me ? store.get(gid, me, date) : null;
        if (myStatus) { cell.classList.add("mine"); cell.style.setProperty("--myc", myColor); }
        // 멤버 순서 고정: 전원을 같은 순서로, 안 나오는 날은 빈 슬롯으로 자리 유지
        const tags = members.map((m) => {
          const st = store.get(gid, m.name, date);
          return st
            ? `<span class="ptag ${st}" style="--c:${m.color}">${m.name}</span>`
            : `<span class="ptag empty"></span>`;
        }).join("");
        cell.innerHTML = `<span class="num">${dd}</span><div class="tags">${tags}</div>`;
        cell.onclick = () => onDayClick(date);
        daysEl.appendChild(cell);
      }
    }

    // 탭마다 순환: 안나옴 → 종일 → 오전반차 → 오후반차 → 안나옴
    const CYCLE = [null, "full", "am", "pm"];
    const STATUS_LABEL = { full: "종일 출근 🌞", am: "오전 반차 🌅 (오후 나와요)", pm: "오후 반차 🌆 (오전 나와요)" };
    async function onDayClick(date) {
      if (!me) { toast("먼저 위에서 이름을 골라줘요!"); return; }
      const cur = store.get(gid, me, date);
      const next = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
      try {
        await store.setStatus(gid, me, date, next);
        renderDays();
        toast(`${date} · ${STATUS_LABEL[next] || "안 나옴 ❌"}`);
      } catch (e) {
        console.error(e);
        toast("저장 실패 😢 다시 시도해줘요");
      }
    }

    $("prevBtn").onclick = () => { weekStart = addDays(weekStart, -7); renderDays(); };
    $("nextBtn").onclick = () => { weekStart = addDays(weekStart, 7); renderDays(); };
    $("todayBtn").onclick = () => { weekStart = startOfWeek(new Date()); renderDays(); };

    renderChips();
    renderDays();

    // 출근 데이터 로드 + 실시간 구독
    store.watchGroup(gid, () => renderDays())
      .then(() => renderDays())
      .catch((e) => { console.error(e); toast("출근 데이터 로드 실패 😢"); });

    pushRecent(gid, group.name);
  }

  // =========================================================
  //  시작 — 라우팅
  // =========================================================
  async function main() {
    try {
      await store.init();
    } catch (e) {
      console.error("저장소 초기화 실패:", e);
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
