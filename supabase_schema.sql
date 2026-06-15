-- ============================================================
--  bobyak — Supabase 테이블 스키마
--  Supabase 대시보드 > SQL Editor 에 붙여넣고 RUN 하세요.
-- ============================================================

create table if not exists absences (
  id      bigint generated always as identity primary key,
  member  text not null,
  date    text not null,                       -- 'YYYY-MM-DD'
  created_at timestamptz default now(),
  unique (member, date)
);

-- 누구나 읽고/쓰게 (로그인 없는 단톡방용). 보안이 필요하면 정책을 좁히세요.
alter table absences enable row level security;

drop policy if exists "public read"   on absences;
drop policy if exists "public insert" on absences;
drop policy if exists "public delete" on absences;

create policy "public read"   on absences for select using (true);
create policy "public insert" on absences for insert with check (true);
create policy "public delete" on absences for delete using (true);

-- 실시간 동기화 활성화 (대시보드 Database > Replication 에서 켜도 됨)
alter publication supabase_realtime add table absences;
