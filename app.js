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

  // ---------- 테마 = 식사 (큐트/낮=점심, 다크/밤=저녁) ----------
  const THEME_KEY = "bobyak_theme";
  let activeRender = null; // 현재 달력 다시 그리기 훅
  function applyTheme(th) {
    document.documentElement.dataset.theme = th;
    const btn = document.getElementById("themeBtn");
    if (btn) btn.textContent = th === "dark" ? "☀️" : "🌙";
  }
  let theme = localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "cute";
  applyTheme(theme);
  const _themeBtn = document.getElementById("themeBtn");
  if (_themeBtn) _themeBtn.onclick = () => {
    theme = theme === "dark" ? "cute" : "dark";
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
    if (activeRender) activeRender(); // 점심↔저녁 전환 반영
  };

  // ---------- 업데이트 소식 (릴리즈 노트) ----------
  const RELEASES = [
    {
      v: "1.0", date: "2026-06-16", title: "첫 출시",
      items: [
        "모임 만들기 → 링크로 단톡방에 공유",
        "점심 / 저녁 참석 따로 체크 (테마 전환 = 식사 전환)",
        "일간(식탁)·주간·월간 뷰",
        "집합시간 — 식탁 위 디지털 시계",
        "외식 제안",
        "자리마다 사유 말풍선",
        "돗자리 꾸미기 (패턴·색)",
        "단톡방 공유 한 줄 복사",
        "큐트/다크 테마, 멤버 색 바꾸기",
      ],
    },
  ];
  function renderReleases() {
    const body = document.getElementById("releaseBody");
    if (!body) return;
    body.innerHTML = RELEASES.map((r) =>
      `<div class="release-ver">v${r.v} · ${r.title}</div>` +
      `<div class="release-date">${r.date}</div>` +
      `<ul>${r.items.map((it) => `<li>${it}</li>`).join("")}</ul>`
    ).join("");
  }
  const _relBtn = document.getElementById("releaseBtn");
  const _relBg = document.getElementById("releaseBackdrop");
  const _relModal = document.getElementById("releaseModal");
  function closeReleases() { _relBg.classList.add("hidden"); _relModal.classList.add("hidden"); }
  if (_relBtn) _relBtn.onclick = () => { renderReleases(); _relBg.classList.remove("hidden"); _relModal.classList.remove("hidden"); };
  if (_relBg) _relBg.onclick = closeReleases;
  const _relClose = document.getElementById("releaseClose");
  if (_relClose) _relClose.onclick = closeReleases;

  // 현재 식사: 큐트=점심(lunch), 다크=저녁(dinner)
  function currentMeal() { return document.documentElement.dataset.theme === "dark" ? "dinner" : "lunch"; }
  // 레거시 'full'은 점심·저녁 둘 다로 간주
  function attendsMeal(status, meal) { return status === "both" || status === "full" || status === meal; }
  function toggledMeal(cur, meal) {
    let l = cur === "lunch" || cur === "both" || cur === "full";
    let d = cur === "dinner" || cur === "both" || cur === "full";
    if (meal === "lunch") l = !l; else d = !d;
    return l && d ? "both" : l ? "lunch" : d ? "dinner" : null;
  }

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
  const nk = (gid, name, date, meal) => `${gid}|${name}|${date}|${meal}`; // 사유(메모) 키
  const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // 돗자리(배경) 색 팔레트 + hex→rgba
  const MAT_PALETTE = ["#f5c542", "#ff9ec0", "#6fd3b0", "#7fb8ff", "#ffb47a", "#b69cf0", "#ff8e8e", "#9fd86f"];
  function hexRgba(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
  // 네모난 디지털 탁상시계 (LCD 느낌) — 집합시간 / 미정이면 --:--
  function clockHTML(time, meal) {
    const t = time || "--:--";
    const ml = meal === "dinner" ? "저녁" : "점심";
    return `<div class="digiclock ${time ? "" : "digi-empty"}" id="digiClock" title="집합시간 정하기">
      <i class="knob l"></i><i class="knob r"></i>
      <div class="lcd">
        <span class="lcd-time">${t}</span>
        <span class="lcd-side"><span class="lcd-meal">${ml}</span><span class="lcd-sub">약속</span></span>
      </div>
      <i class="foot l"></i><i class="foot r"></i>
    </div>`;
  }

  // =========================================================
  //  저장소 추상화
  // =========================================================

  // ---- 로컬 저장소 ----
  const LocalStore = {
    mode: "로컬",
    GK: "bobyak_groups_v2",
    MKEY: "bobyak_marks_v3",
    NKEY: "bobyak_notes_v1",
    groups: {},
    marks: {}, // key -> 'lunch' | 'dinner' | 'both'
    notes: {}, // nk -> 사유 텍스트
    async init() {
      try { this.groups = JSON.parse(localStorage.getItem(this.GK) || "{}"); } catch { this.groups = {}; }
      try { this.marks = JSON.parse(localStorage.getItem(this.MKEY) || "{}"); } catch { this.marks = {}; }
      try { this.notes = JSON.parse(localStorage.getItem(this.NKEY) || "{}"); } catch { this.notes = {}; }
    },
    _saveG() { localStorage.setItem(this.GK, JSON.stringify(this.groups)); },
    _saveM() { localStorage.setItem(this.MKEY, JSON.stringify(this.marks)); },
    _saveN() { localStorage.setItem(this.NKEY, JSON.stringify(this.notes)); },
    getNote(gid, name, date, meal) { return this.notes[nk(gid, name, date, meal)] || ""; },
    async setNote(gid, name, date, meal, text) {
      const k = nk(gid, name, date, meal);
      if (text) this.notes[k] = text; else delete this.notes[k];
      this._saveN();
    },
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
      Object.keys(this.notes).forEach((k) => {
        if (k.startsWith(pre)) { this.notes[`${gid}|${newN}|${k.slice(pre.length)}`] = this.notes[k]; delete this.notes[k]; }
      });
      this._saveM(); this._saveN();
    },
    async deleteMemberData(gid, name) {
      const pre = `${gid}|${name}|`;
      Object.keys(this.marks).forEach((k) => { if (k.startsWith(pre)) delete this.marks[k]; });
      Object.keys(this.notes).forEach((k) => { if (k.startsWith(pre)) delete this.notes[k]; });
      this._saveM(); this._saveN();
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
    marks: {}, // key -> 'lunch' | 'dinner' | 'both'
    notes: {}, // nk -> 사유 텍스트
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
      // 사유(notes) 로드 — 테이블이 없으면 무시 (마이그레이션 전)
      this.notes = {};
      try {
        const nr = await this.client.from("notes").select("member,date,meal,text").eq("group_id", gid);
        if (!nr.error && nr.data) nr.data.forEach((r) => { if (r.text) this.notes[nk(gid, r.member, r.date, r.meal)] = r.text; });
      } catch (_) { /* notes 테이블 없음 */ }
      this.client
        .channel("abs-" + gid)
        .on("postgres_changes",
          { event: "*", schema: "public", table: "absences", filter: `group_id=eq.${gid}` },
          (p) => {
            if (p.eventType === "DELETE") delete this.marks[ak(gid, p.old.member, p.old.date)];
            else this.marks[ak(gid, p.new.member, p.new.date)] = p.new.status || "full";
            this._cb && this._cb();
          })
        .on("postgres_changes",
          { event: "*", schema: "public", table: "notes", filter: `group_id=eq.${gid}` },
          (p) => {
            const key = nk(gid, (p.new || p.old).member, (p.new || p.old).date, (p.new || p.old).meal);
            if (p.eventType === "DELETE" || !p.new.text) delete this.notes[key];
            else this.notes[key] = p.new.text;
            this._cb && this._cb();
          })
        .subscribe();
    },
    get(gid, name, date) { return this.marks[ak(gid, name, date)] || null; },
    getNote(gid, name, date, meal) { return this.notes[nk(gid, name, date, meal)] || ""; },
    async setNote(gid, name, date, meal, text) {
      const k = nk(gid, name, date, meal);
      const prev = this.notes[k] || "";
      if (text) {
        this.notes[k] = text;
        const { error } = await this.client.from("notes")
          .upsert({ group_id: gid, member: name, date, meal, text }, { onConflict: "group_id,member,date,meal" });
        if (error) { prev ? (this.notes[k] = prev) : delete this.notes[k]; throw error; }
      } else {
        delete this.notes[k];
        const { error } = await this.client.from("notes")
          .delete().eq("group_id", gid).eq("member", name).eq("date", date).eq("meal", meal);
        if (error) { if (prev) this.notes[k] = prev; throw error; }
      }
    },
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
      await this.client.from("notes").update({ member: newN }).eq("group_id", gid).eq("member", oldN);
      const pre = `${gid}|${oldN}|`;
      [this.marks, this.notes].forEach((map) => {
        Object.keys(map).forEach((k) => {
          if (k.startsWith(pre)) { map[`${gid}|${newN}|${k.slice(pre.length)}`] = map[k]; delete map[k]; }
        });
      });
    },
    async deleteMemberData(gid, name) {
      const { error } = await this.client.from("absences")
        .delete().eq("group_id", gid).eq("member", name);
      if (error) throw error;
      await this.client.from("notes").delete().eq("group_id", gid).eq("member", name);
      const pre = `${gid}|${name}|`;
      [this.marks, this.notes].forEach((map) => {
        Object.keys(map).forEach((k) => { if (k.startsWith(pre)) delete map[k]; });
      });
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
    activeRender = null;
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
    function startOfWeek(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
    function addDays(d, n) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
    function snapWeekday(d) { let x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); while (x.getDay() === 0 || x.getDay() === 6) x = addDays(x, 1); return x; }
    let weekStart = startOfWeek(new Date()); // 보고 있는 주의 월요일
    let currentDay = snapWeekday(new Date()); // 일간 뷰에서 보고 있는 날
    let monthY = t.y, monthM = t.m;           // 월간 뷰에서 보고 있는 달

    const VKEY = `bobyak_view_${gid}`;
    const _v = localStorage.getItem(VKEY);
    let viewMode = (_v === "day" || _v === "month") ? _v : "week";

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

    // 색 고르기 팝업
    const pickerEl = $("colorPicker"), pickerBg = $("pickerBackdrop");
    function closePicker() { pickerEl.classList.add("hidden"); pickerBg.classList.add("hidden"); }
    pickerBg.onclick = closePicker;
    function openColorPicker(m) {
      $("cpTitle").textContent = `${m.name} 색 고르기`;
      const sw = $("cpSwatches");
      sw.innerHTML = "";
      palette.forEach((c) => {
        const b = document.createElement("button");
        b.className = "cp-sw" + (c.toLowerCase() === (m.color || "").toLowerCase() ? " sel" : "");
        b.style.background = c;
        b.onclick = async () => {
          const prev = m.color;
          if (c === prev) { closePicker(); return; }
          m.color = c;
          try {
            await store.setMembers(gid, members);
            closePicker(); renderChips(); renderDays();
            toast(`${m.name} 색 변경!`);
          } catch (e) { console.error(e); m.color = prev; toast("색 변경 실패 😢"); }
        };
        sw.appendChild(b);
      });
      pickerEl.classList.remove("hidden"); pickerBg.classList.remove("hidden");
    }

    // ----- 돗자리(일간 배경) 꾸미기 -----
    const MATKEY = `bobyak_mat_${gid}`;
    let mat = { pattern: "check", color: "#f5c542" };
    try { const m = JSON.parse(localStorage.getItem(MATKEY) || "null"); if (m && m.color) mat = m; } catch (_) {}
    function applyMat(el) {
      const base = hexRgba(mat.color, .13), pat = hexRgba(mat.color, .42);
      el.style.backgroundColor = base;
      if (mat.pattern === "dots") {
        el.style.backgroundImage = `radial-gradient(${pat} 21%, transparent 22%), radial-gradient(${pat} 21%, transparent 22%)`;
        el.style.backgroundSize = "22px 22px";
        el.style.backgroundPosition = "0 0, 11px 11px";
      } else {
        el.style.backgroundImage = `repeating-linear-gradient(0deg, ${pat} 0 11px, transparent 11px 22px), repeating-linear-gradient(90deg, ${pat} 0 11px, transparent 11px 22px)`;
        el.style.backgroundSize = "auto"; el.style.backgroundPosition = "0 0";
      }
    }
    function clearMat(el) { ["background", "backgroundColor", "backgroundImage", "backgroundSize", "backgroundPosition"].forEach((p) => { el.style[p] = ""; }); }

    const matPickerEl = $("matPicker"), matBg = $("matBackdrop");
    function closeMatPicker() { matPickerEl.classList.add("hidden"); matBg.classList.add("hidden"); }
    matBg.onclick = closeMatPicker;
    function refreshMatPicker() {
      document.querySelectorAll("#matPatterns .mat-pat").forEach((b) => b.classList.toggle("active", b.dataset.pat === mat.pattern));
      const sw = $("matSwatches"); sw.innerHTML = "";
      MAT_PALETTE.forEach((c) => {
        const b = document.createElement("button");
        b.className = "cp-sw" + (c.toLowerCase() === mat.color.toLowerCase() ? " sel" : "");
        b.style.background = c;
        b.onclick = () => { mat = { ...mat, color: c }; localStorage.setItem(MATKEY, JSON.stringify(mat)); renderDays(); refreshMatPicker(); };
        sw.appendChild(b);
      });
    }
    document.querySelectorAll("#matPatterns .mat-pat").forEach((b) => {
      b.onclick = () => { mat = { ...mat, pattern: b.dataset.pat }; localStorage.setItem(MATKEY, JSON.stringify(mat)); renderDays(); refreshMatPicker(); };
    });
    $("matBtn").onclick = () => { refreshMatPicker(); matBg.classList.remove("hidden"); matPickerEl.classList.remove("hidden"); };

    // ----- 집합시간 제안 (날짜·식사별 단일 시간 + 👍) -----
    const MEET = "##meet##"; // notes 테이블 재활용용 특수 키
    const PRESETS = { lunch: ["11:30", "11:40", "11:50", "12:00"], dinner: ["17:30", "17:40", "18:00", "18:10"] };
    function getMeetup(date, meal) {
      try { const t = store.getNote(gid, MEET, date, meal); const o = t ? JSON.parse(t) : null; return (o && typeof o === "object") ? { time: o.time || "", likes: o.likes || [] } : { time: "", likes: [] }; }
      catch (_) { return { time: "", likes: [] }; }
    }
    async function saveMeetup(date, meal, obj) {
      const empty = !obj.time && (!obj.likes || obj.likes.length === 0);
      await store.setNote(gid, MEET, date, meal, empty ? "" : JSON.stringify(obj));
    }
    function renderMeetBar(date, meal) {
      const bar = $("meetBar");
      bar.classList.remove("hidden");
      const mu = getMeetup(date, meal);
      if (mu.time) {
        const liked = me && mu.likes.includes(me);
        bar.innerHTML =
          `<span class="meet-time">📍 집합 <b>${mu.time}</b></span>` +
          `<button class="meet-like ${liked ? "on" : ""}" id="meetLike" title="${escapeHtml(mu.likes.join(", "))}">👍 ${mu.likes.length}</button>` +
          `<button class="meet-edit" id="meetEdit">변경</button>`;
        $("meetLike").onclick = () => toggleMeetLike(date, meal);
      } else {
        bar.innerHTML = `<button class="meet-propose" id="meetEdit">📍 집합시간 제안하기</button>`;
      }
      $("meetEdit").onclick = () => openMeetPicker(date, meal);
    }
    async function toggleMeetLike(date, meal) {
      if (!me) { toast("먼저 위에서 이름을 골라줘요!"); return; }
      const mu = getMeetup(date, meal);
      const i = mu.likes.indexOf(me);
      if (i >= 0) mu.likes.splice(i, 1); else mu.likes.push(me);
      try { await saveMeetup(date, meal, mu); renderDays(); }
      catch (e) { console.error(e); toast("저장 실패 😢"); }
    }
    const meetPickerEl = $("meetPicker"), meetBg = $("meetBackdrop");
    function closeMeetPicker() { meetPickerEl.classList.add("hidden"); meetBg.classList.add("hidden"); }
    meetBg.onclick = closeMeetPicker;
    async function setMeetTime(date, meal, time) {
      try { await saveMeetup(date, meal, { time }); closeMeetPicker(); renderDays(); toast(time ? `집합 ${time} ✓` : "집합시간 지움"); }
      catch (e) { console.error(e); toast("저장 실패 😢 (공유모드면 notes 마이그레이션 필요)"); }
    }
    function openMeetPicker(date, meal) {
      const mu = getMeetup(date, meal);
      $("meetTitle").textContent = `📍 ${meal === "dinner" ? "저녁" : "점심"} 집합시간`;
      const pe = $("meetPresets"); pe.innerHTML = "";
      PRESETS[meal].forEach((tm) => {
        const b = document.createElement("button");
        b.className = "preset" + (mu.time === tm ? " sel" : "");
        b.textContent = tm;
        b.onclick = () => setMeetTime(date, meal, tm);
        pe.appendChild(b);
      });
      $("meetCustom").onclick = () => {
        const v = (prompt("집합시간 (예: 12:40)", mu.time) || "").trim();
        if (!v) return;
        if (!/^\d{1,2}:\d{2}$/.test(v)) { toast("HH:MM 형식으로 입력해줘요"); return; }
        setMeetTime(date, meal, v);
      };
      $("meetClear").onclick = () => setMeetTime(date, meal, "");
      meetBg.classList.remove("hidden"); meetPickerEl.classList.remove("hidden");
    }

    // ----- 단톡방 공유 한 줄 복사 -----
    async function copyText(text, okMsg) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); toast(okMsg); return; }
        throw new Error("no clipboard");
      } catch (_) {
        const ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); toast(okMsg); } catch { toast("복사 실패 — 직접 복사해줘요"); }
        document.body.removeChild(ta);
      }
    }
    function buildSummary(date, meal) {
      const [y, mo, dd] = date.split("-").map(Number);
      const wd = ["일", "월", "화", "수", "목", "금", "토"][new Date(y, mo - 1, dd).getDay()];
      const present = members.filter((m) => attendsMeal(store.get(gid, m.name, date), meal));
      const absent = members.filter((m) => !attendsMeal(store.get(gid, m.name, date), meal));
      const mu = getMeetup(date, meal);
      const link = `${location.origin}/?g=${gid}`;
      const L = [];
      L.push(`[${mo}/${dd}(${wd}) ${meal === "dinner" ? "저녁" : "점심"}]`);
      L.push(`${mu.time ? `${mu.time} 집합 · ` : ""}${present.length}/${members.length}`);
      if (present.length) L.push(`참석: ${present.map((m) => m.name).join(", ")}`);
      if (absent.length) L.push(`불참: ${absent.map((m) => m.name).join(", ")}`);
      const guests = getGuests(date, meal);
      if (guests.length) L.push(`객원: ${guests.join(", ")}`);
      L.push(link);
      return L.join("\n");
    }
    let curDate = null, curMeal = null; // 현재 일간 뷰의 날짜·식사 (공유/객원 버튼용)
    $("shareDay").onclick = () => { if (curDate) copyText(buildSummary(curDate, curMeal), "복사 완료! 단톡방에 붙여넣기 📋"); };
    $("guestBtn").onclick = () => { if (curDate) addGuestPrompt(curDate, curMeal); };

    function renderChips() {
      chipsEl.innerHTML = "";
      members.forEach((m, idx) => {
        const b = document.createElement(editMode ? "span" : "button");
        b.className = "chip" + (!editMode && me === m.name ? " selected" : "") + (editMode ? " editing" : "");
        b.style.setProperty("--c", m.color);
        if (editMode) {
          b.innerHTML = `<span class="dot" style="background:${m.color}"></span>` +
            `<span class="cname">${m.name}</span><span class="x" title="삭제">✕</span>`;
          b.querySelector(".dot").onclick = () => openColorPicker(m);
          b.querySelector(".cname").onclick = () => renameMember(m);
          b.querySelector(".x").onclick = () => deleteMember(m, idx);
        } else {
          b.innerHTML = `<span class="dot" style="background:${m.color}"></span>${m.name}`;
          b.onclick = () => selectMe(m.name);
        }
        chipsEl.appendChild(b);
      });
    }


    // 뷰 디스패처
    function renderDays() {
      const ml = $("mealLabel");
      if (ml) ml.textContent = currentMeal() === "dinner" ? "🌙 저녁 약속" : "🌞 점심 약속";
      calEl.classList.toggle("locked", !me);
      document.querySelector(".weekdays").classList.toggle("hidden", viewMode === "day");
      daysEl.classList.toggle("days", viewMode !== "day");
      daysEl.classList.toggle("dayview", viewMode === "day");
      document.querySelectorAll(".vt").forEach((b) => b.classList.toggle("active", b.dataset.mode === viewMode));
      $("todayBtn").textContent = viewMode === "day" ? "오늘로" : viewMode === "month" ? "이번 달로" : "이번 주로";
      $("dayActions").classList.toggle("hidden", viewMode !== "day");
      if (viewMode !== "day") { clearMat(daysEl); $("meetBar").classList.add("hidden"); }
      daysEl.innerHTML = "";
      if (viewMode === "day") renderDay();
      else if (viewMode === "month") renderMonth();
      else renderWeek();
    }

    // 날짜 칸 하나 만들기 (주간/월간 공통)
    function buildDayCell(yy, mm, dd) {
      const meal = currentMeal();
      const date = ymd(yy, mm, dd);
      const myColor = me ? memberByName[me].color : null;
      const cell = document.createElement("div");
      cell.className = "day";
      if (yy === t.y && mm === t.m && dd === t.d) cell.classList.add("today");
      if (me && attendsMeal(store.get(gid, me, date), meal)) {
        cell.classList.add("mine"); cell.style.setProperty("--myc", myColor);
      }
      // 멤버 순서 고정: 전원을 같은 순서로, 안 나오는 날은 빈 슬롯으로 자리 유지
      let presentCount = 0;
      const tags = members.map((m) => {
        const on = attendsMeal(store.get(gid, m.name, date), meal);
        if (on) presentCount++;
        return on
          ? `<span class="ptag full" style="--c:${m.color}">${m.name}</span>`
          : `<span class="ptag empty"></span>`;
      }).join("");
      if (members.length >= 2 && presentCount === members.length) cell.classList.add("allin");
      cell.innerHTML = `<span class="num">${dd}</span><div class="tags">${tags}</div>`;
      cell.onclick = () => onDayClick(date);
      return cell;
    }

    function renderWeek() {
      const s = weekStart, e = addDays(weekStart, 4);
      $("calTitle").textContent =
        `${s.getMonth() + 1}월 ${s.getDate()}일 – ${e.getMonth() + 1}월 ${e.getDate()}일`;
      for (let i = 0; i < 5; i++) {
        const day = addDays(weekStart, i);
        daysEl.appendChild(buildDayCell(day.getFullYear(), day.getMonth(), day.getDate()));
      }
    }

    // 월간: 평일(월~금)만, 주별로 줄바꿈 (주간과 같은 칸 스타일)
    function renderMonth() {
      $("calTitle").textContent = `${monthY}년 ${monthM + 1}월`;
      const lastDay = new Date(monthY, monthM + 1, 0).getDate();
      const firstDow = (new Date(monthY, monthM, 1).getDay() + 6) % 7; // 0=월..6=일
      for (let i = 0; i < Math.min(firstDow, 5); i++) {
        const blank = document.createElement("div");
        blank.className = "day empty";
        daysEl.appendChild(blank);
      }
      for (let d = 1; d <= lastDay; d++) {
        const dow = (new Date(monthY, monthM, d).getDay() + 6) % 7;
        if (dow > 4) continue; // 토일 제외
        daysEl.appendChild(buildDayCell(monthY, monthM, d));
      }
    }

    // 일간: 둥근 식탁에 밥그릇(참석 🍚 / 불참 🥣)
    function renderDay() {
      const day = currentDay;
      const yy = day.getFullYear(), mm = day.getMonth(), dd = day.getDate();
      const date = ymd(yy, mm, dd);
      const wd = ["일", "월", "화", "수", "목", "금", "토"][day.getDay()];
      const isToday = (yy === t.y && mm === t.m && dd === t.d);
      $("calTitle").textContent = `${mm + 1}월 ${dd}일 (${wd})${isToday ? " · 오늘" : ""}`;

      const meal = currentMeal();
      const n = members.length;
      const dense = n > 7;          // 인원 많으면 빽빽 모드
      const R = dense ? 112 : 120;  // 자리 반경
      let cnt = 0, eatCnt = 0;
      const seats = members.map((m, i) => {
        const ang = (i / n) * 2 * Math.PI - Math.PI / 2;
        const x = Math.cos(ang) * R, y = Math.sin(ang) * R;
        const on = attendsMeal(store.get(gid, m.name, date), meal);
        if (on) cnt++;
        const eat = on && isEat(m.name, date, meal);
        if (eat) eatCnt++;
        const isMe = me === m.name;
        const note = store.getNote(gid, m.name, date, meal);
        const bubble = note
          ? `<div class="bubble has" data-name="${m.name}">${escapeHtml(note)}</div>`
          : (isMe ? `<div class="bubble add" data-name="${m.name}">＋사유</div>` : "");
        return `<div class="seat ${on ? "" : "absent"} ${isMe ? "me" : ""}"
          style="transform:translate(${x}px,${y}px)">
          ${bubble}
          <div class="seat-main" data-name="${m.name}">
            ${eat ? `<span class="eat-icon">✋</span>` : ""}
            <div class="bowl">${on ? "🍚" : "🥣"}</div>
            <div class="snm" style="background:${m.color}">${m.name}</div>
          </div></div>`;
      }).join("");
      const allin = members.length >= 2 && cnt === members.length;
      const mu = getMeetup(date, meal);
      const guests = getGuests(date, meal);
      const guestRow = guests.length
        ? `<div class="guest-row">${guests.map((g) =>
            `<button class="guest" data-guest="${escapeHtml(g)}" title="탭하면 제거">` +
            `<span class="guest-hand">🙋</span><span class="guest-name">${escapeHtml(g)}</span></button>`).join("")}</div>`
        : "";
      daysEl.innerHTML =
        `<div class="table-wrap ${dense ? "dense" : ""}">
          <div class="table-center ${allin ? "allin" : ""}">${clockHTML(mu.time, meal)}</div>${seats}
        </div>
        ${guestRow}
        <div class="table-count">참석 ${cnt}/${members.length}${guests.length ? ` · 객원 ${guests.length}` : ""} · 외식 제안 ${eatCnt}/${members.length}</div>`;
      curDate = date; curMeal = meal; // 공유/객원 버튼이 참조
      applyMat(daysEl); // 돗자리 배경
      const dc = document.getElementById("digiClock");
      if (dc) dc.onclick = () => openMeetPicker(date, meal);
      daysEl.querySelectorAll(".guest").forEach((el) => { el.onclick = () => removeGuest(date, meal, el.dataset.guest); });
      daysEl.querySelectorAll(".seat-main").forEach((el) => {
        el.onclick = () => onSeatClick(el.dataset.name, date);
      });
      daysEl.querySelectorAll(".bubble").forEach((el) => {
        el.onclick = (e) => { e.stopPropagation(); onBubbleClick(el.dataset.name, date); };
      });
    }

    // 말풍선 탭 → 본인이면 사유 편집, 남이면 전체 내용 토스트로
    async function onBubbleClick(name, date) {
      const meal = currentMeal();
      if (me !== name) {
        const txt = store.getNote(gid, name, date, meal);
        if (txt) toast(`${name}: ${txt}`);
        return;
      }
      const cur = store.getNote(gid, me, date, meal);
      const label = meal === "dinner" ? "저녁" : "점심";
      const txt = (prompt(`${date} ${label} 사유/메모 (비우면 삭제)`, cur) || "").trim();
      if (txt === cur) return;
      try {
        await store.setNote(gid, me, date, meal, txt);
        renderDays();
        toast(txt ? "사유 저장 ✓" : "사유 삭제");
      } catch (e) {
        console.error(e);
        toast("사유 저장 실패 😢 (공유모드면 notes 마이그레이션 필요)");
      }
    }

    // 외식(✋) 플래그 — notes 테이블 재활용 (meal+"#eat")
    function isEat(name, date, meal) { return store.getNote(gid, name, date, meal + "#eat") === "1"; }
    async function setEat(name, date, meal, on) { await store.setNote(gid, name, date, meal + "#eat", on ? "1" : ""); }

    // 객원(가끔 오는 멤버) — 그 날·식사에만, notes 재활용 (member="##guest##", JSON 배열)
    function getGuests(date, meal) { try { return JSON.parse(store.getNote(gid, "##guest##", date, meal) || "[]"); } catch (_) { return []; } }
    async function setGuests(date, meal, arr) { await store.setNote(gid, "##guest##", date, meal, arr.length ? JSON.stringify(arr) : ""); }
    async function addGuestPrompt(date, meal) {
      const name = (prompt("객원(가끔 오는 멤버) 이름은?") || "").trim();
      if (!name) return;
      const g = getGuests(date, meal);
      if (g.includes(name) || members.some((m) => m.name === name)) { toast("이미 있는 이름이에요"); return; }
      g.push(name);
      try { await setGuests(date, meal, g); renderDays(); toast(`${name} 객원 추가 🙋`); }
      catch (e) { console.error(e); toast("추가 실패 😢"); }
    }
    async function removeGuest(date, meal, name) {
      if (!confirm(`객원 '${name}' 뺄까요?`)) return;
      try { await setGuests(date, meal, getGuests(date, meal).filter((x) => x !== name)); renderDays(); toast(`${name} 객원 제거`); }
      catch (e) { console.error(e); toast("제거 실패 😢"); }
    }

    // 일간: 자리 탭 → 본인 아니면 본인 선택, 본인이면 순환(불참→참석→외식→불참)
    async function onSeatClick(name, date) {
      if (me !== name) {
        me = name; localStorage.setItem(MEKEY, me);
        renderChips(); renderDays();
        toast(`${name}(으)로 설정! 또 누르면 참석`);
        return;
      }
      const meal = currentMeal();
      const ml = meal === "dinner" ? "저녁" : "점심";
      const attending = attendsMeal(store.get(gid, me, date), meal);
      try {
        if (!attending) {
          await store.setStatus(gid, me, date, toggledMeal(store.get(gid, me, date), meal));
          toast(`${date} ${ml} 참석 🍚`);
        } else if (!isEat(me, date, meal)) {
          await setEat(me, date, meal, true);
          toast(`${date} ${ml} 외식 제안 ✋`);
        } else {
          await setEat(me, date, meal, false);
          await store.setStatus(gid, me, date, toggledMeal(store.get(gid, me, date), meal));
          toast(`${date} ${ml} 불참`);
        }
        renderDays();
      } catch (e) { console.error(e); toast("저장 실패 😢"); }
    }

    // 탭마다 (현재 식사) 참석 ↔ 불참 토글
    async function onDayClick(date) {
      if (!me) { toast("먼저 위에서 이름을 골라줘요!"); return; }
      const meal = currentMeal();
      const cur = store.get(gid, me, date);
      const next = toggledMeal(cur, meal);
      const ml = meal === "dinner" ? "저녁 🌙" : "점심 🌞";
      try {
        await store.setStatus(gid, me, date, next);
        renderDays();
        toast(attendsMeal(next, meal) ? `${date} ${ml} 참석 ✓` : `${date} ${ml} 불참`);
      } catch (e) {
        console.error(e);
        toast("저장 실패 😢 다시 시도해줘요");
      }
    }

    function moveDay(delta) {
      let d = addDays(currentDay, delta);
      while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, delta > 0 ? 1 : -1);
      currentDay = d;
    }
    function moveMonth(delta) {
      monthM += delta;
      if (monthM < 0) { monthM = 11; monthY--; }
      if (monthM > 11) { monthM = 0; monthY++; }
    }

    // 뷰 전환 토글
    document.querySelectorAll(".vt").forEach((b) => {
      b.onclick = () => { viewMode = b.dataset.mode; localStorage.setItem(VKEY, viewMode); renderDays(); };
    });

    $("prevBtn").onclick = () => {
      if (viewMode === "day") moveDay(-1); else if (viewMode === "month") moveMonth(-1); else weekStart = addDays(weekStart, -7);
      renderDays();
    };
    $("nextBtn").onclick = () => {
      if (viewMode === "day") moveDay(1); else if (viewMode === "month") moveMonth(1); else weekStart = addDays(weekStart, 7);
      renderDays();
    };
    $("todayBtn").onclick = () => {
      if (viewMode === "day") currentDay = snapWeekday(new Date());
      else if (viewMode === "month") { monthY = t.y; monthM = t.m; }
      else weekStart = startOfWeek(new Date());
      renderDays();
    };

    activeRender = renderDays; // 테마(점심/저녁) 전환 시 이 달력 다시 그림
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
