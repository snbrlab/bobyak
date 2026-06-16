// ============================================================
//  bobyak 설정 파일  🍚
//  이제 멤버는 '모임 만들기' 화면에서 입력해요.
//  여기선 색 팔레트와 Supabase 키만 관리합니다.
// ============================================================

// ※ window.* 에 직접 할당해야 다른 스크립트(app.js)에서 잡혀요.
//    (일반 스크립트의 최상위 const/let 는 window 속성이 되지 않음)
window.BOBYAK_CONFIG = {
  appName: "bobyak",

  // ----------------------------------------------------------
  //  멤버 색 팔레트 — 모임 만들 때 추가 순서대로 자동 배정돼요.
  //  더 많은 멤버를 위해 색을 추가해도 됩니다.
  // ----------------------------------------------------------
  palette: [
    "#FF8FA3", // 로즈
    "#FB9968", // 코랄
    "#F4C95D", // 허니
    "#8BD17C", // 라임그린
    "#4FC79B", // 에메랄드
    "#45C0D0", // 시안
    "#6FA8E5", // 스카이블루
    "#8C8CF0", // 페리윙클
    "#B07CE8", // 바이올렛
    "#E07CC3", // 오키드
  ],

  // ----------------------------------------------------------
  //  Supabase 연결 (공유 모드)
  //  비워두면 → 이 브라우저에만 저장되는 'localStorage 모드'.
  //  채워두면 → 링크를 받은 모두가 같은 달력 + 실시간 동기화.
  //  ※ 모임별 링크를 진짜로 '공유'하려면 Supabase가 필요해요. (README 참고)
  // ----------------------------------------------------------
  supabase: {
    url: "https://wrtboawksvrqzjapsyym.supabase.co",
    anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndydGJvYXdrc3ZycXpqYXBzeXltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1MTA1NzksImV4cCI6MjA5NzA4NjU3OX0.PcBrhUmvFxKdLCARTpMZF5Kg9xZs3WR6g1TKqWFMJ3g",
  },
};
