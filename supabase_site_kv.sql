-- 모든 로컬 편집 데이터(일정 수정, 맛집 카드, 팁, 히어로, 지도 핀 등)를
-- 기기/브라우저 간 동기화하기 위한 공통 key-value 저장소

create table if not exists public.site_kv (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

alter table public.site_kv enable row level security;

create policy "allow all site_kv" on public.site_kv
  for all
  using (true)
  with check (true);
