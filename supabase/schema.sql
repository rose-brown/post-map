-- Phase 3 다기기 동기화. 스펙 4.1·4.2.
-- docs/superpowers/specs/2026-09-27-phase3-multidevice-sync-design.md
--
-- 접근 제어는 프로젝트 uuid 를 x-project-id 헤더로 보내는 비밀 링크다 (D4).
-- Supabase 가 Auth 없이 anon role 만 쓰는 앱을 위해 문서화한 request.headers 패턴을 쓴다.
-- 로그인이 없으므로 auth.uid() 를 쓸 수 없고, 헤더의 uuid 가 유일한 권한 근거다.
--
-- 적용: Supabase 대시보드 → SQL Editor 에 이 파일 전체를 붙여 실행한다.

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  initial_view jsonb not null,
  schema_version int not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table public.layers (
  id text primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  kind text not null,
  visible boolean not null,
  "order" int not null,
  style jsonb not null,
  schema jsonb not null default '[]',
  locked boolean not null
);

-- geometry 는 jsonb 다 (D6). PostGIS 를 쓰지 않는다 —
-- 공간 연산이 전부 클라이언트 turf 라 서버가 공간 질의를 한 번도 하지 않는다.
-- 서버측 공간 질의가 필요해지면(PRD D-4) 컬럼 타입 변경으로 전환한다.
create table public.features (
  id text primary key,
  project_id uuid not null references public.projects(id) on delete cascade,  -- RLS 용 비정규화 (D7)
  layer_id text not null references public.layers(id) on delete cascade,
  parent_id text references public.features(id) on delete cascade,
  geometry jsonb not null,
  title text not null default '',
  properties jsonb not null default '{}',
  blocks jsonb not null default '[]',
  derived_from jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

-- 이미지 바이트는 Storage, 관계와 경로는 여기 (D9).
-- 경로만으로는 StoredBlob.featureId 관계가 사라져 getBlob(id) 와 고아 정리가 불가능하다.
create table public.blobs (
  id text primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  feature_id text not null references public.features(id) on delete cascade,
  path text not null,
  mime text not null,
  size int not null
);

create index on public.layers (project_id);
create index on public.features (project_id);
create index on public.features (layer_id);
create index on public.features (parent_id);
create index on public.blobs (feature_id);

-- RLS: 헤더의 uuid 와 일치하는 행만 보인다.
-- 헤더가 없으면 오른쪽이 NULL 이 되어 비교가 NULL → 0건이다. 그래서 목록 열람이 막힌다.
alter table public.projects enable row level security;
alter table public.layers   enable row level security;
alter table public.features enable row level security;
alter table public.blobs    enable row level security;

create policy "link scoped" on public.projects
for all to anon
using      ( id = (current_setting('request.headers', true)::json->>'x-project-id')::uuid )
with check ( id = (current_setting('request.headers', true)::json->>'x-project-id')::uuid );

create policy "link scoped" on public.layers
for all to anon
using      ( project_id = (current_setting('request.headers', true)::json->>'x-project-id')::uuid )
with check ( project_id = (current_setting('request.headers', true)::json->>'x-project-id')::uuid );

create policy "link scoped" on public.features
for all to anon
using      ( project_id = (current_setting('request.headers', true)::json->>'x-project-id')::uuid )
with check ( project_id = (current_setting('request.headers', true)::json->>'x-project-id')::uuid );

create policy "link scoped" on public.blobs
for all to anon
using      ( project_id = (current_setting('request.headers', true)::json->>'x-project-id')::uuid )
with check ( project_id = (current_setting('request.headers', true)::json->>'x-project-id')::uuid );

-- projects INSERT 만 예외다. 새 프로젝트를 만드는 순간에는 아직 uuid 를 모르므로
-- 헤더를 보낼 수 없다. 헤더가 비어 있을 때만 허용하고, 클라이언트는 응답의 id 를
-- 즉시 헤더에 박는다 (src/db/repo.ts 의 createProject).
create policy "create new project" on public.projects
for insert to anon
with check ( current_setting('request.headers', true)::json->>'x-project-id' is null );

-- Storage: public 버킷이라 읽기는 URL 을 아는 사람만 가능하다.
-- SELECT 정책을 주지 않으므로 목록 열람(list)이 막힌다 — 이것이 D9 의 전제이고,
-- 계획 Task 1 Step 4 의 (5) 에서 실제로 막히는지 확인해야 한다.
insert into storage.buckets (id, name, public) values ('blobs', 'blobs', true)
on conflict (id) do nothing;

create policy "anon upload" on storage.objects
for insert to anon with check ( bucket_id = 'blobs' );

create policy "anon delete" on storage.objects
for delete to anon using ( bucket_id = 'blobs' );
