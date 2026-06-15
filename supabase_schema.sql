-- ============================================================
--  bobyak — Supabase 스키마 (모임별 링크 버전)
--  Supabase 대시보드 > SQL Editor 에 붙여넣고 RUN 하세요.
--  ※ 예전(단일 달력) 버전을 만들었다면, 아래를 다시 RUN 하면 됩니다.
-- ============================================================

-- 모임: 모임장이 만들 때 이름과 멤버(이름+색) 저장
create table if not exists groups (
  id         text primary key,              -- 랜덤 슬러그 (링크의 ?g=...)
  name       text not null,
  members    jsonb not null,                -- [{ "name": "가은", "color": "#FF8FAB" }, ...]
  created_at timestamptz default now()
);

-- 부재: 모임별로 멤버가 어떤 날짜에 빠지는지
create table if not exists absences (
  id         bigint generated always as identity primary key,
  group_id   text not null references groups(id) on delete cascade,
  member     text not null,
  date       text not null,                 -- 'YYYY-MM-DD'
  status     text not null default 'full',  -- 'full'(종일) | 'am'(오전반차,오후나옴) | 'pm'(오후반차,오전나옴)
  created_at timestamptz default now(),
  unique (group_id, member, date)
);
create index if not exists absences_group_idx on absences (group_id);
-- 이미 테이블이 있던 경우용 (컬럼 추가)
alter table absences add column if not exists status text not null default 'full';

-- 로그인 없는 단톡방용: 누구나 읽기/쓰기 허용.
alter table groups   enable row level security;
alter table absences enable row level security;

drop policy if exists "groups read"    on groups;
drop policy if exists "groups insert"  on groups;
drop policy if exists "groups update"  on groups;
create policy "groups read"   on groups for select using (true);
create policy "groups insert" on groups for insert with check (true);
create policy "groups update" on groups for update using (true) with check (true);

drop policy if exists "abs read"   on absences;
drop policy if exists "abs insert" on absences;
drop policy if exists "abs update" on absences;
drop policy if exists "abs delete" on absences;
create policy "abs read"   on absences for select using (true);
create policy "abs insert" on absences for insert with check (true);
create policy "abs update" on absences for update using (true) with check (true);  -- 반차 변경(upsert)·이름수정용
create policy "abs delete" on absences for delete using (true);

-- 실시간 동기화 활성화
alter publication supabase_realtime add table absences;
alter publication supabase_realtime add table groups;
