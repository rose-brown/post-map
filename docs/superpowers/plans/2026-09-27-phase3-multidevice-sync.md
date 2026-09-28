# Phase 3 구현 계획 — 다기기 동기화 (Supabase)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PC 에서 작도·입력한 내용이 서버에 저장되고, 폰에서 같은 링크를 열면 그대로 보이며 양쪽에서 고칠 수 있다.

**Architecture:** `src/db/repo.ts` 의 공개 함수 14개 시그니처를 유지하고 내부만 Dexie → Supabase 로 교체한다.
스토어·UI·지도는 손대지 않는다. 접근 제어는 프로젝트 uuid 를 `?p=` URL 과 `x-project-id` 헤더로 보내는
비밀 링크이고, RLS 정책이 그 헤더와 행의 `project_id` 를 비교해 강제한다. IndexedDB 는 읽기 경로에서
빠지고 이관 원본으로만 남는다.

**Tech Stack:** Vite + React 19 + TS strict, zustand 5, Terra Draw 1.35, MapLibre 6, Dexie 4 (이관용으로 유지),
`@supabase/supabase-js` 2 (신규), Node 22.23.0 내장 `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-27-phase3-multidevice-sync-design.md` — 결정 D1~D11 과
3절(확인된 사실 / 미확인 지점 / 명시된 한계)을 **먼저 읽어라.**

## Global Constraints

- **불변 규칙 1** — `repo.ts` 의 저장 함수는 계속 `Persistable<T>` 만 받는다. 시그니처를 바꾸면 게이트가 죽는다.
- **불변 규칙 2** — 저장 좌표계는 EPSG:4326 단일. 변환하지 않는다.
- **불변 규칙 4 의 새 예외** — `VITE_SUPABASE_URL`·`VITE_SUPABASE_ANON_KEY` 는 번들에 들어간다.
  anon key 는 공개 전제로 설계되어 RLS 가 실제 방어선이라는 것을 `src/db/supabase.ts` 주석에 남긴다.
- **불변 규칙 5** — 지오메트리는 GeoJSON 그대로. `geometry` 컬럼은 jsonb (D6, PostGIS 아님).
- **불변 규칙 6** — 도메인 용어를 코드에 박지 않는다.
- **불변 규칙 7** — 새 버튼·안내는 `min-h-[44px]` 등 레이아웃 조건으로 44px 을 보장한다. `pointer: coarse` 에 의존하지 않는다.
- `optimizeDeps.exclude: ['maplibre-gl']` 를 지우지 않는다.
- zustand 셀렉터 안에서 배열·객체를 새로 만들지 않는다.
- `map.isStyleLoaded()` 를 게이트로 쓰지 않는다. `mapReady` 만 쓴다.
- 새 삭제 경로도 `MapView` 동기화 이펙트(`syncedIds` 고아 제거)를 우회하지 않는다.
- Terra Draw 로 가는 좌표는 소수점 **9자리** 이하. 서버 왕복은 jsonb 라 값을 바꾸지 않지만, 왕복 후에도 이 성질이 유지되는지 Task 8 에서 확인한다.
- UI 문구는 한국어, 기존 톤(짧은 명사형).
- 커밋 메시지 끝 두 줄:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NnkXdXoX18Pi7gtD9ZFs55
  ```
- **시크릿을 커밋하지 않는다.** `.env` 는 이미 `.gitignore` 에 있다. `.env.example` 에는 자리표시자만 넣는다.

## 테스트 방식

CLAUDE.md 는 "테스트 러너가 없다"고 적었고, Phase 2-A 계획이 **의존성 없이 Node 내장 `node:test`** 로
순수 함수만 TDD 하는 방식을 정했다. 이 계획도 그것을 따른다.

- **순수 함수**(`db/mappers.ts`, `db/project-link.ts` 의 결정 함수)는 `node:test` 로 TDD 한다.
  테스트는 `tests/*.test.ts`, 실행은 `npm test`.
- **실측으로 확인한 사실** (Node 22.23.0): `.ts` 는 타입 제거로 그냥 실행된다.
  단 **`node --test tests/` (디렉터리 인자) 는 실패한다** — `MODULE_NOT_FOUND`.
  기본 탐색 패턴이 `.ts` 를 잡지 않기 때문이다. **glob 을 써야 한다**:
  `node --test 'tests/**/*.test.ts'` (따옴표 필수 — 셸이 아니라 Node 가 전개해야 한다).
- 그래서 **`db/mappers.ts`·`db/project-link.ts` 는 런타임 import 를 하지 않는다**(`import type` 은 지워지므로 괜찮다).
  테스트 파일은 `../src/db/mappers.ts` 처럼 확장자를 붙여 import 한다.
- `tests/` 는 `tsconfig.app.json` 의 `include: ["src"]` 밖이라 빌드·타입체크에 들어가지 않는다.
- **I/O 경로**(Supabase 호출, Storage)는 단위 테스트하지 않는다. 서버가 필요하므로 curl 과 Playwright MCP 로 확인한다.
- **저장 게이트 자체 점검**은 CLAUDE.md 의 것을 그대로 쓴다 (Task 4·8).
- 모든 태스크 끝에 `npm run typecheck` 통과.

## 파일 구조

| 파일 | 책임 |
|---|---|
| `supabase/schema.sql` | 신규. 테이블·인덱스·RLS 정책·Storage 버킷. 저장소에 두어 재현 가능하게 한다 |
| `src/db/supabase.ts` | 신규. uuid 를 받아 `x-project-id` 헤더가 박힌 클라이언트를 만든다. 다른 책임 없음 |
| `src/db/mappers.ts` | 신규. 도메인 타입 ↔ DB 행 변환. **순수** — import 없음, I/O 없음 |
| `src/db/project-link.ts` | 신규. uuid 결정(URL → localStorage → 없음)과 URL·localStorage 기록 |
| `src/db/repo.ts` | 수정. 내부를 Supabase 로. **공개 함수 14개 시그니처 유지** |
| `src/db/migrate-local.ts` | 신규. IndexedDB → 서버 복사 (F-81) |
| `src/store/useStore.ts` | 수정. `init()` 이 projectId 를 받는다. 그 외 그대로 |
| `src/ui/TopBar.tsx` | 수정. 저장 상태에 실패·재시도 표시 |
| `src/ui/StartGate.tsx` | 신규. uuid 없음 → 이관 안내 / 새로 시작, 읽기 실패 → 오류·재시도 |
| `src/types.ts` | 수정. Project id 만 full uuid 로 |
| `src/db/db.ts`, `src/db/migrations.ts` | **건드리지 않는다.** 이관 원본 |
| `src/ui/Blocks.tsx`, `src/map/*` | **건드리지 않는다.** blob 시그니처가 유지되므로 |

---

### Task 1: 서버 스키마·정책과 RLS 실제 차단 확인

이 태스크의 산출물은 **검증된 서버**다. 코드는 SQL 하나뿐이고, 확인이 본체다.

**Files:**
- Create: `supabase/schema.sql`
- Modify: `.env.example`

**Interfaces:**
- Consumes: 없음
- Produces: 동작하는 Supabase 프로젝트. `.env` 에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
  테이블 `projects`(uuid pk) / `layers` / `features` / `blobs`, Storage 버킷 `blobs`.

- [ ] **Step 1: Supabase 프로젝트 생성 — 사람이 실행**

CLAUDE.md 의 경계다. 에이전트가 하지 않는다. 사용자에게 다음을 요청한다:

1. https://supabase.com 에서 프로젝트 생성. 리전 **`ap-northeast-2`(서울)**, 무료 티어.
2. Project Settings → API 에서 `Project URL` 과 `anon public` 키를 복사.
3. 저장소 루트 `.env` 에 추가 (`.env` 는 커밋되지 않는다):

```
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...
```

- [ ] **Step 2: `supabase/schema.sql` 작성**

```sql
-- Phase 3 다기기 동기화. 스펙 4.1·4.2.
-- 접근 제어는 프로젝트 uuid 를 x-project-id 헤더로 보내는 비밀 링크다 (D4).
-- Supabase 가 anon-only 앱용으로 문서화한 request.headers 패턴을 쓴다.

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

create table public.features (
  id text primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
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

-- RLS: 헤더의 uuid 와 일치하는 행만. 헤더가 없으면 NULL 비교로 0건이 된다.
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

-- projects INSERT 만 예외: 새 프로젝트를 만들 때는 아직 uuid 를 모른다.
-- 헤더가 비어 있을 때만 허용하고, 그 즉시 클라이언트가 uuid 를 받아 헤더에 박는다.
create policy "create new project" on public.projects
for insert to anon
with check ( current_setting('request.headers', true)::json->>'x-project-id' is null );

-- Storage: 바이트만 여기. 메타데이터는 public.blobs (D9).
-- public 버킷이라 읽기는 URL 을 아는 사람만 가능하고, SELECT 정책을 주지 않아 목록 열람이 막힌다.
insert into storage.buckets (id, name, public) values ('blobs', 'blobs', true)
on conflict (id) do nothing;

create policy "anon upload" on storage.objects
for insert to anon with check ( bucket_id = 'blobs' );

create policy "anon delete" on storage.objects
for delete to anon using ( bucket_id = 'blobs' );
```

- [ ] **Step 3: SQL 실행 — 사람이 실행**

Supabase 대시보드 → SQL Editor 에 `supabase/schema.sql` 전체를 붙여 실행한다.
에이전트가 대시보드에 접근할 수 없으므로 사용자에게 요청한다.

- [ ] **Step 4: RLS 가 실제로 막는지 확인 — 이 태스크의 핵심**

정책을 썼다고 막히는 게 아니다. 막히는 것을 봐야 한다.

```bash
set -a; . ./.env; set +a
U="$VITE_SUPABASE_URL"; A="$VITE_SUPABASE_ANON_KEY"

# (1) 헤더 없이 projects 조회 → [] 여야 한다
curl -s "$U/rest/v1/projects?select=*" -H "apikey: $A"

# (2) 프로젝트 생성 (헤더 없음 → "create new project" 정책으로 허용)
P=$(curl -s "$U/rest/v1/projects" -H "apikey: $A" \
     -H 'Content-Type: application/json' -H 'Prefer: return=representation' \
     -d '{"name":"rls-check","initial_view":{"lng":127,"lat":37.5,"zoom":11,"bearing":0,"pitch":0},
          "schema_version":1,"created_at":"2026-09-27T00:00:00Z","updated_at":"2026-09-27T00:00:00Z"}' \
     | python3 -c 'import sys,json; print(json.load(sys.stdin)[0]["id"])')
echo "project=$P"

# (3) 틀린 uuid → [] 여야 한다
curl -s "$U/rest/v1/projects?select=*" -H "apikey: $A" \
     -H "x-project-id: 00000000-0000-0000-0000-000000000000"

# (4) 맞는 uuid → 1건이 나와야 한다
curl -s "$U/rest/v1/projects?select=*" -H "apikey: $A" -H "x-project-id: $P"

# (5) Storage 목록 열람이 막히는지 → 빈 배열 또는 거부여야 한다
curl -s "$U/storage/v1/object/list/blobs" -H "apikey: $A" \
     -H 'Content-Type: application/json' -d '{"prefix":"","limit":100}'
```

기대값: (1) `[]` · (3) `[]` · (4) 1건 · (5) 빈 배열이나 거부.

**(5) 가 객체를 나열하면 D9 의 전제가 깨진다.** 그때는 `public` 버킷을 `false` 로 바꾸고
Storage 접근을 Task 5 에서 다시 설계한다 — 스펙 3절의 "미확인" 항목이 여기서 판정된다.
결과를 스펙 3절에 한 줄로 기록한다.

- [ ] **Step 5: 확인용 프로젝트 정리**

```bash
curl -s -X DELETE "$U/rest/v1/projects?id=eq.$P" -H "apikey: $A" -H "x-project-id: $P"
```

- [ ] **Step 6: `.env.example` 갱신**

```
# Supabase (Phase 3). anon key 는 공개 전제 — 실제 방어선은 RLS 다. 불변 규칙 4 의 예외.
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

- [ ] **Step 7: 커밋**

```bash
git add supabase/schema.sql .env.example
git commit -F - <<'MSG'
feat: Phase 3 서버 스키마와 비밀 링크 RLS

프로젝트 uuid 를 x-project-id 헤더로 보내고 정책이 그것과 행의
project_id 를 비교한다. 헤더가 없으면 NULL 비교로 0건이 되어
projects 목록 열람이 막힌다. 새 프로젝트 생성만 헤더 없는 INSERT 를
허용한다 — 그 시점에는 uuid 를 모른다.

geometry 는 jsonb 다 (스펙 D6). 공간 연산이 전부 클라이언트 turf 라
서버가 공간 질의를 하지 않는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NnkXdXoX18Pi7gtD9ZFs55
MSG
```

---

### Task 2: 순수 매퍼와 테스트 기반

**Files:**
- Create: `src/db/mappers.ts`, `tests/mappers.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 1 의 컬럼 이름
- Produces:
  ```ts
  projectToRow(p: Project): ProjectRow
  rowToProject(r: ProjectRow): Project
  layerToRow(l: Layer, projectId: string): LayerRow
  rowToLayer(r: LayerRow): Layer
  featureToRow(f: Feature, projectId: string): FeatureRow
  rowToFeature(r: FeatureRow): Feature
  ```
  `*Row` 타입도 이 파일이 export 한다.

- [ ] **Step 1: `npm test` 스크립트 추가**

`package.json` 의 `scripts` 에 넣는다. **glob 을 따옴표로 감싸야 한다** — Node 가 전개해야 하고,
`node --test tests/` 는 Node 22 에서 `MODULE_NOT_FOUND` 로 실패한다 (실측 확인).

```json
"test": "node --test 'tests/**/*.test.ts'"
```

- [ ] **Step 2: 실패하는 테스트 작성**

`tests/mappers.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  featureToRow, rowToFeature, layerToRow, rowToLayer, projectToRow, rowToProject,
} from '../src/db/mappers.ts'
import type { Feature, Layer, Project } from '../src/types.ts'

const PID = '11111111-1111-1111-1111-111111111111'

const feature: Feature = {
  id: 'feat_abc123456789',
  layerId: 'lay_abc123456789',
  geometry: { type: 'Point', coordinates: [127.123456789, 37.123456789] },
  title: '집',
  properties: { icon: 'home', radius: 500 },
  blocks: [{ id: 'blk_1', type: 'text', text: '메모' }],
  parentId: null,
  createdAt: '2026-09-27T00:00:00.000Z',
  updatedAt: '2026-09-27T00:00:01.000Z',
}

test('feature 왕복이 값을 보존한다', () => {
  assert.deepEqual(rowToFeature(featureToRow(feature, PID)), feature)
})

test('featureToRow 가 project_id 를 채운다', () => {
  assert.equal(featureToRow(feature, PID).project_id, PID)
})

test('좌표 정밀도가 왕복에서 바뀌지 않는다', () => {
  const back = rowToFeature(featureToRow(feature, PID))
  assert.deepEqual(back.geometry, feature.geometry)
})

test('derivedFrom 이 없으면 null 로 나가고 undefined 로 돌아온다', () => {
  const row = featureToRow(feature, PID)
  assert.equal(row.derived_from, null)
  assert.equal(rowToFeature(row).derivedFrom, undefined)
})

test('derivedFrom 이 있으면 왕복한다', () => {
  const ring: Feature = {
    ...feature,
    id: 'feat_ring00000001',
    derivedFrom: { op: 'ring', sourceIds: ['feat_abc123456789'], params: { radius: 500 } },
    parentId: 'feat_abc123456789',
  }
  assert.deepEqual(rowToFeature(featureToRow(ring, PID)), ring)
})

const layer: Layer = {
  id: 'lay_abc123456789',
  projectId: PID,
  name: '기본 레이어',
  kind: 'vector',
  visible: true,
  order: 0,
  style: { color: '#2563eb', opacity: 0.3, strokeWidth: 2, pointRadius: 6 },
  schema: [{ key: 'price', label: '가격', type: 'number', unit: '만원' }],
  locked: false,
}

test('layer 왕복이 값을 보존한다', () => {
  assert.deepEqual(rowToLayer(layerToRow(layer, PID)), layer)
})

const project: Project = {
  id: PID,
  name: '내 지도',
  description: '',
  initialView: { lng: 127, lat: 37.5, zoom: 11, bearing: 0, pitch: 0 },
  schemaVersion: 1,
  createdAt: '2026-09-27T00:00:00.000Z',
  updatedAt: '2026-09-27T00:00:01.000Z',
}

test('project 왕복이 값을 보존한다', () => {
  assert.deepEqual(rowToProject(projectToRow(project)), project)
})
```

- [ ] **Step 3: 테스트가 실패하는 것 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/db/mappers.ts'`

- [ ] **Step 4: `src/db/mappers.ts` 작성**

런타임 import 가 없어야 한다 (`import type` 만). Node 가 타입 제거로 실행하기 때문이다.

```ts
import type {
  Block, Feature, Layer, LayerStyle, Project, Properties, PropertySchemaField,
} from '../types'
import type { Geometry } from 'geojson'

/**
 * 도메인 타입 ↔ DB 행 변환. 순수 함수만 둔다 — I/O 도, 런타임 import 도 없다.
 * tests/mappers.test.ts 가 Node 내장 test runner 로 직접 돌리므로 그 성질을 유지해야 한다.
 *
 * 중첩 객체(style·initialView·schema·derivedFrom)는 쪼개지 않고 jsonb 로 둔다 — 서버가 그 안을 질의하지 않는다.
 * 값이 없으면 키를 넣지 않는다는 규칙(PRD 4.3)은 properties 안에서만 적용되고,
 * 컬럼 수준에서는 Postgres 가 null 을 요구하므로 null ↔ undefined 를 여기서 변환한다.
 */

export interface ProjectRow {
  id: string
  name: string
  description: string
  initial_view: Project['initialView']
  schema_version: number
  created_at: string
  updated_at: string
}

export interface LayerRow {
  id: string
  project_id: string
  name: string
  kind: Layer['kind']
  visible: boolean
  order: number
  style: LayerStyle
  schema: PropertySchemaField[]
  locked: boolean
}

export interface FeatureRow {
  id: string
  project_id: string
  layer_id: string
  parent_id: string | null
  geometry: Geometry
  title: string
  properties: Properties
  blocks: Block[]
  derived_from: Feature['derivedFrom'] | null
  created_at: string
  updated_at: string
}

export const projectToRow = (p: Project): ProjectRow => ({
  id: p.id,
  name: p.name,
  description: p.description,
  initial_view: p.initialView,
  schema_version: p.schemaVersion,
  created_at: p.createdAt,
  updated_at: p.updatedAt,
})

export const rowToProject = (r: ProjectRow): Project => ({
  id: r.id,
  name: r.name,
  description: r.description,
  initialView: r.initial_view,
  schemaVersion: r.schema_version,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

export const layerToRow = (l: Layer, projectId: string): LayerRow => ({
  id: l.id,
  project_id: projectId,
  name: l.name,
  kind: l.kind,
  visible: l.visible,
  order: l.order,
  style: l.style,
  schema: l.schema,
  locked: l.locked,
})

export const rowToLayer = (r: LayerRow): Layer => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  kind: r.kind,
  visible: r.visible,
  order: r.order,
  style: r.style,
  schema: r.schema,
  locked: r.locked,
})

export const featureToRow = (f: Feature, projectId: string): FeatureRow => ({
  id: f.id,
  project_id: projectId,
  layer_id: f.layerId,
  parent_id: f.parentId ?? null,
  geometry: f.geometry,
  title: f.title,
  properties: f.properties,
  blocks: f.blocks,
  derived_from: f.derivedFrom ?? null,
  created_at: f.createdAt,
  updated_at: f.updatedAt,
})

export const rowToFeature = (r: FeatureRow): Feature => {
  const f: Feature = {
    id: r.id,
    layerId: r.layer_id,
    geometry: r.geometry,
    title: r.title,
    properties: r.properties,
    blocks: r.blocks,
    parentId: r.parent_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
  if (r.derived_from) f.derivedFrom = r.derived_from
  return f
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — 7 tests

주의: `rowToFeature` 는 `derivedFrom` 이 없을 때 **키를 넣지 않는다**. `deepEqual` 은
`{a:1}` 과 `{a:1, b:undefined}` 를 다르게 본다. 실패하면 이 지점을 먼저 보라.

- [ ] **Step 6: 타입체크**

Run: `npm run typecheck`
Expected: 통과. `tests/` 는 `include: ["src"]` 밖이라 포함되지 않는다.

- [ ] **Step 7: 커밋**

```bash
git add package.json src/db/mappers.ts tests/mappers.test.ts
git commit -F - <<'MSG'
feat: 도메인 타입 ↔ DB 행 순수 매퍼

Node 내장 test runner 로 왕복 보존을 확인한다. 의존성 추가 없음.
node --test 는 디렉터리 인자로 .ts 를 못 찾으므로 glob 을 쓴다.

좌표 정밀도 왕복을 테스트로 고정했다 — Terra Draw 가 소수점 9자리
초과를 조용히 거부하는 기존 함정이 서버 왕복에서 되살아나지 않게.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NnkXdXoX18Pi7gtD9ZFs55
MSG
```

---

### Task 3: Supabase 클라이언트와 프로젝트 링크 결정

**Files:**
- Create: `src/db/supabase.ts`, `src/db/project-link.ts`, `tests/project-link.test.ts`
- Modify: `package.json` (의존성)

**Interfaces:**
- Consumes: Task 1 의 `.env` 변수
- Produces:
  ```ts
  // supabase.ts
  makeClient(projectId: string): SupabaseClient
  makeAnonClient(): SupabaseClient          // 헤더 없음 — 새 프로젝트 생성 전용
  // project-link.ts
  type LinkSource = { url: string | null; stored: string | null }
  decideProjectId(src: LinkSource): string | null          // 순수
  readLink(): LinkSource
  commitLink(id: string): void
  ```

- [ ] **Step 1: 의존성 설치 — 네트워크 작업이므로 먼저 알린다**

CLAUDE.md: 패키지 설치는 최소화하고 먼저 알린다. 사용자에게 알린 뒤 실행한다.

```bash
npm install @supabase/supabase-js
```

- [ ] **Step 2: 실패하는 테스트 작성**

`decideProjectId` 만 테스트한다 — `readLink`/`commitLink` 는 브라우저 전역에 닿으므로 뺀다.

`tests/project-link.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideProjectId } from '../src/db/project-link.ts'

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'

test('URL 이 있으면 URL 이 이긴다', () => {
  assert.equal(decideProjectId({ url: A, stored: B }), A)
})

test('URL 이 없으면 저장된 값을 쓴다', () => {
  assert.equal(decideProjectId({ url: null, stored: B }), B)
})

test('둘 다 없으면 null', () => {
  assert.equal(decideProjectId({ url: null, stored: null }), null)
})

test('uuid 형태가 아닌 URL 값은 무시하고 저장값으로 내려간다', () => {
  assert.equal(decideProjectId({ url: 'proj_abc123', stored: B }), B)
})

test('uuid 형태가 아닌 저장값도 무시한다', () => {
  assert.equal(decideProjectId({ url: null, stored: 'garbage' }), null)
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/db/project-link.ts'`

- [ ] **Step 4: `src/db/project-link.ts` 작성**

```ts
/**
 * 어느 프로젝트를 열지 정한다. 우선순위: URL ?p= → localStorage → 없음.
 *
 * localStorage 기록이 없으면 링크를 잃는 순간 데이터에 접근할 수 없다 (스펙 4.4).
 * uuid 는 이 앱에서 사실상 비밀이므로, 형태가 맞지 않는 값은 서버에 보내기 전에 버린다
 * (틀린 헤더는 어차피 0건이지만, 잘못된 값을 URL 에 다시 쓰지 않기 위해).
 *
 * decideProjectId 는 순수 함수다 — tests/project-link.test.ts 가 직접 돌린다.
 */
const KEY = 'map-editor:projectId'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const valid = (v: string | null): string | null => (v && UUID_RE.test(v) ? v : null)

export interface LinkSource {
  url: string | null
  stored: string | null
}

export function decideProjectId(src: LinkSource): string | null {
  return valid(src.url) ?? valid(src.stored)
}

export function readLink(): LinkSource {
  const url = new URLSearchParams(window.location.search).get('p')
  let stored: string | null = null
  try {
    stored = window.localStorage.getItem(KEY)
  } catch {
    // 사파리 프라이빗 등에서 접근이 막힐 수 있다. URL 만으로 동작해야 한다.
  }
  return { url, stored }
}

/** 정해진 id 를 URL 과 localStorage 양쪽에 남긴다. */
export function commitLink(id: string): void {
  const u = new URL(window.location.href)
  if (u.searchParams.get('p') !== id) {
    u.searchParams.set('p', id)
    window.history.replaceState(null, '', u)
  }
  try {
    window.localStorage.setItem(KEY, id)
  } catch {
    // 위와 같다. URL 에는 남았으므로 북마크로 복구할 수 있다.
  }
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — 12 tests (Task 2 의 7개 + 5개)

- [ ] **Step 6: `src/db/supabase.ts` 작성**

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * 불변 규칙 4 의 예외 — anon key 는 번들에 들어간다.
 *
 * 이 키는 처음부터 공개를 전제로 설계된 식별자이고, 실제 방어선은 RLS 다.
 * 정책이 x-project-id 헤더와 행의 project_id 를 비교하므로, 키를 알아도
 * 프로젝트 uuid 를 모르면 아무 행도 읽히지 않는다 (supabase/schema.sql 참조).
 * 따라서 프록시 뒤로 숨길 대상이 아니다. 숨겨야 하는 것은 service_role 키이고,
 * 그 키는 이 저장소에 존재하지 않는다.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const hasSupabaseConfig = Boolean(url && anonKey)

function assertConfig(): { url: string; anonKey: string } {
  if (!url || !anonKey) {
    throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 없습니다. .env 를 확인하세요.')
  }
  return { url, anonKey }
}

/** 프로젝트 uuid 가 정해진 뒤에 만든다. 헤더가 모든 요청에 붙는다. */
export function makeClient(projectId: string): SupabaseClient {
  const c = assertConfig()
  return createClient(c.url, c.anonKey, {
    auth: { persistSession: false },
    global: { headers: { 'x-project-id': projectId } },
  })
}

/** 헤더 없는 클라이언트. 새 프로젝트 INSERT 에만 쓴다 — 그 시점에는 uuid 를 모른다. */
export function makeAnonClient(): SupabaseClient {
  const c = assertConfig()
  return createClient(c.url, c.anonKey, { auth: { persistSession: false } })
}

/** 이미지 공개 URL. public 버킷이라 서명이 필요 없다 (스펙 D9). */
export function publicBlobUrl(path: string): string {
  const c = assertConfig()
  return `${c.url}/storage/v1/object/public/blobs/${path}`
}
```

- [ ] **Step 7: 타입체크와 커밋**

Run: `npm run typecheck`
Expected: 통과

```bash
git add package.json package-lock.json src/db/supabase.ts src/db/project-link.ts tests/project-link.test.ts
git commit -F - <<'MSG'
feat: Supabase 클라이언트와 프로젝트 링크 결정

uuid 우선순위는 URL ?p= → localStorage → 없음. localStorage 기록이
없으면 링크 분실이 곧 데이터 접근 불가가 되므로 양쪽에 남긴다.
localStorage 접근이 막히는 환경(프라이빗 창)에서도 URL 만으로 동작한다.

anon key 가 번들에 들어가는 이유(불변 규칙 4 의 예외)를 supabase.ts
주석에 남겼다 — 방어선은 RLS 이고 service_role 키는 이 저장소에 없다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NnkXdXoX18Pi7gtD9ZFs55
MSG
```

---

### Task 4: `repo.ts` 를 Supabase 로 교체

가장 큰 태스크다. 시그니처 14개를 유지하는 것이 전부다.

**Files:**
- Modify: `src/db/repo.ts`, `src/store/useStore.ts`
- Create: `src/__gate.ts` (임시, Step 6 에서 삭제)

**Interfaces:**
- Consumes: Task 2 의 매퍼, Task 3 의 `makeClient`
- Produces: 같은 14개 공개 함수. 추가로
  ```ts
  setActiveProject(projectId: string): void      // 클라이언트를 만들고 이후 호출이 쓴다
  createProject(p: Persistable<Project>, firstLayer: Persistable<Layer>): Promise<string>
  ```
  `SaveState` 에 `error` 를 더한다: `{ status: 'idle'|'saving'|'saved'|'error'; at?: number; message?: string }`

- [ ] **Step 1: 현재 `repo.ts` 를 읽고 유지할 이름을 표로 옮긴다**

Run: `sed -n '1,177p' src/db/repo.ts` 와 `sed -n '1,47p' src/persist/persistable.ts`

두 가지를 적어 둔다.

1. **공개 함수 14개의 인자·반환 타입.** 이 표에서 벗어나면 게이트가 깨진다.
2. **기존 내부 이름.** 아래 단계의 코드는 `emit`, `timer`, `hasPending`, `unwrap` 같은
   기존 내부 함수·변수를 쓴다. **이름이 다르면 실제 이름에 맞춰라 — 새로 만들지 마라.**
   특히 `Persistable<T>` 에서 값을 꺼내는 함수(`unwrap` 으로 적었다)는 `persistable.ts` 의
   실제 이름을 써야 한다. 새로 만들면 게이트를 우회하는 경로가 된다.

- [ ] **Step 2: 쓰기 경로 교체 — 디바운스 배치를 유지한다**

기존 구조(500ms 디바운스 + 배치 큐 + `onSaveState`)를 그대로 두고, 커밋 지점만
Dexie 트랜잭션 → Supabase `upsert` 로 바꾼다. 큐는 테이블별로 나눈다.

```ts
import { makeClient } from './supabase'
import { featureToRow, layerToRow, projectToRow } from './mappers'
import type { SupabaseClient } from '@supabase/supabase-js'

let sb: SupabaseClient | null = null
let activeProjectId: string | null = null

export function setActiveProject(projectId: string): void {
  activeProjectId = projectId
  sb = makeClient(projectId)
}

function client(): SupabaseClient {
  if (!sb || !activeProjectId) throw new Error('setActiveProject() 가 먼저 불려야 합니다.')
  return sb
}

// 큐: id → 도메인 객체. 같은 id 가 여러 번 들어오면 마지막 것만 남는다.
const pending = {
  projects: new Map<string, Project>(),
  layers: new Map<string, Layer>(),
  features: new Map<string, Feature>(),
  deleteFeatures: new Set<string>(),
  deleteLayers: new Set<string>(),
}
```

`flush()` 는 순서를 지킨다 — FK 때문이다:

```ts
export async function flush(): Promise<void> {
  if (timer !== null) { clearTimeout(timer); timer = null }
  if (!hasPending()) return
  const pid = activeProjectId!
  emit({ status: 'saving' })
  try {
    const c = client()
    // 순서: projects → layers → features → 삭제(features → layers)
    if (pending.projects.size) {
      const rows = [...pending.projects.values()].map(projectToRow)
      const { error } = await c.from('projects').upsert(rows)
      if (error) throw error
      pending.projects.clear()
    }
    if (pending.layers.size) {
      const rows = [...pending.layers.values()].map((l) => layerToRow(l, pid))
      const { error } = await c.from('layers').upsert(rows)
      if (error) throw error
      pending.layers.clear()
    }
    if (pending.features.size) {
      const rows = [...pending.features.values()].map((f) => featureToRow(f, pid))
      const { error } = await c.from('features').upsert(rows)
      if (error) throw error
      pending.features.clear()
    }
    if (pending.deleteFeatures.size) {
      const ids = [...pending.deleteFeatures]
      const { error } = await c.from('features').delete().in('id', ids)
      if (error) throw error
      pending.deleteFeatures.clear()
    }
    if (pending.deleteLayers.size) {
      const ids = [...pending.deleteLayers]
      const { error } = await c.from('layers').delete().in('id', ids)
      if (error) throw error
      pending.deleteLayers.clear()
    }
    emit({ status: 'saved', at: Date.now() })
  } catch (e) {
    // 큐를 비우지 않는다 — 재시도가 같은 것을 다시 보낸다 (Task 7).
    emit({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    throw e
  }
}
```

**큐를 실패 시 비우지 않는 것이 핵심이다.** 비우면 조용히 사라진다.

- [ ] **Step 3: 읽기 경로 교체**

```ts
export async function loadAll(projectId: string): Promise<{
  project: Project | undefined
  layers: Layer[]
  features: Feature[]
}> {
  const c = client()
  const [p, l, f] = await Promise.all([
    c.from('projects').select('*').eq('id', projectId).maybeSingle(),
    c.from('layers').select('*').eq('project_id', projectId).order('order'),
    c.from('features').select('*').eq('project_id', projectId),
  ])
  if (p.error) throw p.error
  if (l.error) throw l.error
  if (f.error) throw f.error
  return {
    project: p.data ? rowToProject(p.data as ProjectRow) : undefined,
    layers: (l.data ?? []).map((r) => rowToLayer(r as LayerRow)),
    features: (f.data ?? []).map((r) => rowToFeature(r as FeatureRow)),
  }
}
```

`firstProjectId()` 는 **더 이상 "첫 프로젝트"를 찾지 않는다.** RLS 가 헤더의 프로젝트만 보여주므로
"첫 프로젝트"는 곧 "그 프로젝트"다. 시그니처를 유지하되 의미를 바꾸고 주석에 적는다:

```ts
/**
 * 헤더의 프로젝트가 서버에 존재하는지 확인해 그 id 를 돌려준다.
 * RLS 가 다른 프로젝트를 보여주지 않으므로 "첫 프로젝트" = "그 프로젝트"다.
 * 없으면 undefined — 링크가 잘못됐거나 아직 만들지 않은 경우다.
 */
export async function firstProjectId(): Promise<string | undefined> {
  const { data, error } = await client().from('projects').select('id').limit(1).maybeSingle()
  if (error) throw error
  return (data as { id: string } | null)?.id
}
```

- [ ] **Step 4: 새 프로젝트 생성 함수 추가**

헤더 없는 클라이언트로 INSERT 한 뒤, 받은 uuid 로 활성 클라이언트를 만든다.

```ts
import { makeAnonClient } from './supabase'

/** 새 프로젝트와 기본 레이어를 만들고 uuid 를 돌려준다. 이후 호출은 그 프로젝트로 간다. */
export async function createProject(
  p: Persistable<Project>,
  firstLayer: Persistable<Layer>,
): Promise<string> {
  const row = projectToRow(unwrap(p))
  // id 는 서버가 gen_random_uuid() 로 만든다 — 클라이언트 값을 보내지 않는다.
  const { id: _drop, ...insert } = row
  const { data, error } = await makeAnonClient()
    .from('projects').insert(insert).select('id').single()
  if (error) throw error
  const projectId = (data as { id: string }).id
  setActiveProject(projectId)
  const { error: le } = await client().from('layers').insert(layerToRow(unwrap(firstLayer), projectId))
  if (le) throw le
  return projectId
}
```

`unwrap` 은 기존 `persist/persistable.ts` 의 값 추출 함수를 쓴다. 없으면 그 파일을 읽어 이름을 확인한다 —
**새로 만들지 마라.** 게이트를 우회하는 새 경로가 된다.

- [ ] **Step 5: `useStore.init()` 이 projectId 를 받도록**

```ts
init: async (projectId: string) => {
  if (initPromise) return initPromise          // StrictMode 이중 마운트 가드 — 지우지 마라
  initPromise = (async () => {
    setActiveProject(projectId)
    const { project, layers, features } = await loadAll(projectId)
    if (!project) throw new Error('이 링크의 프로젝트를 찾을 수 없습니다.')
    const ensured = layers.length ? layers : [newLayer(project.id, 0, '기본 레이어')]
    set({ project, layers: ensured, features, ready: true })
  })()
  return initPromise
}
```

기존 "없으면 새로 만든다" 분기는 **여기서 빼고** Task 6 의 `StartGate` 로 옮긴다.
`init()` 은 이제 "있는 것을 읽는다"만 한다.

- [ ] **Step 6: 저장 게이트 자체 점검 — CLAUDE.md 의 것을 그대로**

```bash
cat > src/__gate.ts <<'EOF'
import { fromProvider } from './persist/persistable'
import { geocoder } from './providers/geocoding'
export const x = fromProvider(geocoder, { a: 1 })
EOF
npx tsc -b --force
rm src/__gate.ts
```

Expected: **TS2345** (`'false' is not assignable to type 'true'`). 이게 나지 않으면 불변 규칙 1 이 깨졌다 — 되돌려라.

- [ ] **Step 7: 타입체크와 테스트**

Run: `npm run typecheck && npm test`
Expected: 둘 다 통과 (테스트 12개)

- [ ] **Step 8: 커밋**

```bash
git add src/db/repo.ts src/store/useStore.ts
git commit -F - <<'MSG'
feat: repo 를 Supabase 로 교체 (시그니처 유지)

공개 함수 14개의 시그니처를 그대로 두고 내부만 Dexie → Supabase 로
바꿨다. 스토어·UI·지도는 손대지 않았다. 저장 게이트 자체 점검에서
TS2345 가 그대로 난다.

flush() 는 FK 순서를 지킨다: projects → layers → features → 삭제.
실패 시 큐를 비우지 않는다 — 비우면 조용히 사라진다. 재시도는 Task 7.

firstProjectId() 는 의미가 바뀌었다. RLS 가 헤더의 프로젝트만
보여주므로 "첫 프로젝트"가 곧 "그 프로젝트"다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NnkXdXoX18Pi7gtD9ZFs55
MSG
```

---

### Task 5: 이미지 — `blobs` 테이블과 Storage

**Files:**
- Modify: `src/db/repo.ts`

**Interfaces:**
- Consumes: Task 3 의 `publicBlobUrl`, Task 1 의 `blobs` 테이블·버킷
- Produces: 같은 시그니처 — `putBlob(rec: StoredBlob): Promise<void>`,
  `getBlob(id: string): Promise<Blob | undefined>`, `deleteBlob(id: string): Promise<void>`.
  `ui/Blocks.tsx` 는 수정하지 않는다.

- [ ] **Step 1: 파일 크기 상한 상수 추가**

스펙 3절: Storage 업로드를 프로젝트 단위로 막을 수 없으므로 클라이언트에서 상한을 건다.

```ts
/** 파일당 상한. Storage 업로드를 프로젝트 단위로 막을 수 없어 악용을 완화한다 (스펙 3절). */
export const MAX_BLOB_BYTES = 10 * 1024 * 1024
```

- [ ] **Step 2: `putBlob` 교체**

```ts
export async function putBlob(rec: StoredBlob): Promise<void> {
  if (rec.blob.size > MAX_BLOB_BYTES) {
    throw new Error(`파일이 너무 큽니다 (최대 ${MAX_BLOB_BYTES / 1024 / 1024}MB)`)
  }
  const pid = activeProjectId!
  const path = `${pid}/${rec.id}`
  // 순서가 중요하다: 업로드 먼저, 메타 행 나중. 반대면 경로 없는 행이 남는다.
  const up = await client().storage.from('blobs').upload(path, rec.blob, {
    contentType: rec.blob.type || 'application/octet-stream',
    upsert: false,
  })
  if (up.error) throw up.error
  const { error } = await client().from('blobs').insert({
    id: rec.id,
    project_id: pid,
    feature_id: rec.featureId,
    path,
    mime: rec.blob.type || 'application/octet-stream',
    size: rec.blob.size,
  })
  if (error) throw error
}
```

- [ ] **Step 3: `getBlob` 교체**

public 버킷이므로 서명 없이 `fetch` 한다. 메타 행을 먼저 읽어 경로를 얻는다 —
그래야 RLS 가 프로젝트 경계를 지킨다.

```ts
export async function getBlob(id: string): Promise<Blob | undefined> {
  const { data, error } = await client()
    .from('blobs').select('path').eq('id', id).maybeSingle()
  if (error) throw error
  const path = (data as { path: string } | null)?.path
  if (!path) return undefined
  const res = await fetch(publicBlobUrl(path))
  if (!res.ok) return undefined
  return res.blob()
}
```

- [ ] **Step 4: `deleteBlob` 교체 — Storage 먼저, 메타 행 나중**

```ts
export async function deleteBlob(id: string): Promise<void> {
  const { data, error } = await client()
    .from('blobs').select('path').eq('id', id).maybeSingle()
  if (error) throw error
  const path = (data as { path: string } | null)?.path
  if (path) {
    const rm = await client().storage.from('blobs').remove([path])
    if (rm.error) throw rm.error
  }
  const { error: de } = await client().from('blobs').delete().eq('id', id)
  if (de) throw de
}
```

- [ ] **Step 5: 피처·레이어 삭제 경로에서 blob 을 먼저 지운다**

FK cascade 는 `blobs` 메타 행만 지우고 Storage 객체를 남긴다 (스펙 4.5).
`deleteFeatures` / `deleteLayer` 가 큐에 넣기 **전에** 해당 blob 을 정리한다.

```ts
/** 해당 피처들에 달린 이미지를 Storage 에서 먼저 지운다. FK cascade 는 메타 행만 지운다. */
async function purgeBlobsOfFeatures(featureIds: string[]): Promise<void> {
  if (!featureIds.length) return
  const { data, error } = await client()
    .from('blobs').select('id, path').in('feature_id', featureIds)
  if (error) throw error
  const rows = (data ?? []) as { id: string; path: string }[]
  if (!rows.length) return
  const rm = await client().storage.from('blobs').remove(rows.map((r) => r.path))
  if (rm.error) throw rm.error
  // 메타 행은 features 삭제 시 cascade 로 사라진다. 여기서 또 지우지 않는다.
}
```

`deleteFeatures(ids)` 안에서 `void purgeBlobsOfFeatures(ids)` 를 부르지 말고 **await 한다** —
실패를 삼키면 고아가 쌓인다. 기존 시그니처가 `void` 이므로, 실패는 `emit({status:'error'})` 로 알린다.

- [ ] **Step 6: 브라우저에서 확인**

```bash
npm run dev
```

Playwright MCP 로: 도형 선택 → 정보 페이지 → gallery 블록에 이미지 추가 → 새로고침 후에도 보이는지.
그다음 그 피처를 삭제하고 Supabase 대시보드 Storage 에서 객체가 사라졌는지 확인한다.

- [ ] **Step 7: 10MB 상한 확인**

10MB 를 넘는 파일을 넣어 안내가 뜨고 업로드가 일어나지 않는지 확인한다.

- [ ] **Step 8: 타입체크와 커밋**

```bash
npm run typecheck && npm test
git add src/db/repo.ts
git commit -F - <<'MSG'
feat: 이미지를 Storage 로, 메타데이터는 blobs 테이블

바이트는 public 버킷의 <projectUuid>/<blobId>, 관계와 경로는 RLS 가
보호하는 blobs 테이블에 둔다. getBlob 은 메타 행으로 경로를 얻은 뒤
공개 URL 을 fetch 한다 — 경로만으로는 featureId 관계가 사라진다.

FK cascade 는 메타 행만 지우고 Storage 객체를 남기므로, 피처·레이어
삭제 경로에서 객체를 먼저 정리한다. 업로드는 프로젝트 단위로 막을 수
없어 파일당 10MB 상한으로 완화했다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NnkXdXoX18Pi7gtD9ZFs55
MSG
```

---

### Task 6: 시작 화면과 이관 (F-81)

**Files:**
- Create: `src/db/migrate-local.ts`, `src/ui/StartGate.tsx`
- Modify: `src/main.tsx` 또는 `src/App.tsx` (어느 쪽이 `init()` 을 부르는지 먼저 확인)
- Modify: `src/types.ts`

**Interfaces:**
- Consumes: Task 3 의 `decideProjectId`/`readLink`/`commitLink`, Task 4 의 `createProject`/`setActiveProject`
- Produces:
  ```ts
  countLocal(): Promise<{ layers: number; features: number; blobs: number }>
  migrateLocalToServer(): Promise<string>   // 새 projectId
  ```

- [ ] **Step 1: Project id 를 full uuid 로**

`src/types.ts` 의 `uid()` 는 그대로 두고(layers·features 가 쓴다), 프로젝트용만 추가한다.

```ts
/**
 * 프로젝트 id 는 비밀 링크로 쓰이므로 절삭하지 않은 uuid 를 쓴다 (스펙 D5).
 * uid() 의 48비트는 링크 비밀로 부족하다. layers·features 는 비밀이 아니라 uid() 를 쓴다.
 */
export const projectUid = (): string => crypto.randomUUID()
```

서버가 `gen_random_uuid()` 로 만들므로 실제로는 INSERT 응답의 id 를 쓴다.
이 함수는 이관 전 로컬 표현에만 쓴다.

- [ ] **Step 2: `src/db/migrate-local.ts` 작성**

```ts
import { db } from './db'
import { setActiveProject, createProject, putBlob, saveFeatures, saveLayer, flush } from './repo'
import { userInput } from '../persist/persistable'
import { nowIso } from '../types'
import type { Feature, Layer, Project } from '../types'

/**
 * IndexedDB → 서버 복사 (F-81). **복사다. 로컬을 지우지 않는다.**
 * 실패하면 부분 복사가 남으므로 호출자가 projects 행 하나를 지워 cascade 로 정리한다.
 */
export async function countLocal(): Promise<{ layers: number; features: number; blobs: number }> {
  const [layers, features, blobs] = await Promise.all([
    db.layers.count(), db.features.count(), db.blobs.count(),
  ])
  return { layers, features, blobs }
}

export async function migrateLocalToServer(): Promise<string> {
  const local = await db.projects.orderBy('updatedAt').last()
  if (!local) throw new Error('이 기기에 복사할 기록이 없습니다.')

  const layers = await db.layers.where('projectId').equals(local.id).toArray()
  const features = await db.features.toArray()

  // 1) 프로젝트 + 첫 레이어. id 는 서버가 만든다.
  const draft: Project = { ...local, id: '', createdAt: local.createdAt, updatedAt: nowIso() }
  const first: Layer = layers[0] ?? {
    id: 'lay_migrated0001', projectId: '', name: '기본 레이어', kind: 'vector',
    visible: true, order: 0,
    style: { color: '#2563eb', opacity: 0.3, strokeWidth: 2, pointRadius: 6 },
    schema: [], locked: false,
  }
  const projectId = await createProject(userInput(draft), userInput(first))

  // 2) 나머지 레이어 → 3) 피처. FK 순서다.
  for (const l of layers.slice(1)) saveLayer(userInput({ ...l, projectId }))
  await flush()
  saveFeatures(features.map((f) => userInput(f)))
  await flush()

  // 4) 이미지. 피처가 먼저 있어야 blobs.feature_id FK 가 통과한다.
  for (const b of await db.blobs.toArray()) await putBlob(b)

  // 5) 재안내 방지 플래그. 로컬 데이터는 그대로 남긴다 (F-81).
  await db.meta.put({ key: 'migratedProjectId', value: projectId })
  return projectId
}
```

- [ ] **Step 3: `src/ui/StartGate.tsx` 작성**

```tsx
import { useEffect, useState } from 'react'
import { decideProjectId, readLink, commitLink } from '../db/project-link'
import { countLocal, migrateLocalToServer } from '../db/migrate-local'
import { createProject, setActiveProject } from '../db/repo'
import { userInput } from '../persist/persistable'
import { nowIso } from '../types'
import { useStore } from '../store/useStore'

type Phase = 'deciding' | 'ask' | 'working' | 'error'

/**
 * 어느 프로젝트를 열지 정하고, 필요하면 이관을 안내한다 (스펙 4.4·4.5).
 * 읽기 실패 시 빈 지도를 보여주지 않는다 — 데이터가 지워진 것으로 오인된다.
 */
export function StartGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>('deciding')
  const [msg, setMsg] = useState('')
  const [counts, setCounts] = useState({ layers: 0, features: 0, blobs: 0 })
  const ready = useStore((s) => s.ready)
  const init = useStore((s) => s.init)

  const open = async (id: string) => {
    setPhase('working')
    try {
      commitLink(id)
      await init(id)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
      setPhase('error')
    }
  }

  useEffect(() => {
    const id = decideProjectId(readLink())
    if (id) { void open(id); return }
    void countLocal().then((c) => {
      setCounts(c)
      setPhase('ask')
    })
  }, [])

  if (ready) return <>{children}</>

  if (phase === 'error') {
    return (
      <div className="p-6 space-y-3">
        <p className="font-medium">지도를 열 수 없습니다</p>
        <p className="text-sm text-neutral-600">{msg}</p>
        <button className="min-h-[44px] px-4 rounded bg-neutral-900 text-white"
                onClick={() => window.location.reload()}>다시 시도</button>
      </div>
    )
  }

  if (phase === 'ask') {
    const has = counts.features > 0
    return (
      <div className="p-6 space-y-3">
        {has ? (
          <>
            <p className="font-medium">이 기기에 기록 {counts.features}건이 있습니다</p>
            <p className="text-sm text-neutral-600">
              서버로 복사하면 다른 기기에서도 볼 수 있습니다. 이 기기의 원본은 지우지 않습니다.
            </p>
            <button className="min-h-[44px] px-4 rounded bg-neutral-900 text-white"
                    onClick={async () => {
                      setPhase('working')
                      try { await open(await migrateLocalToServer()) }
                      catch (e) { setMsg(e instanceof Error ? e.message : String(e)); setPhase('error') }
                    }}>서버로 복사</button>
          </>
        ) : (
          <p className="font-medium">새 지도를 시작합니다</p>
        )}
        <button className="min-h-[44px] px-4 rounded border"
                onClick={async () => {
                  setPhase('working')
                  try {
                    const id = await createProject(
                      userInput({
                        id: '', name: '내 지도', description: '',
                        initialView: { lng: 127.0276, lat: 37.4979, zoom: 13, bearing: 0, pitch: 0 },
                        schemaVersion: 1, createdAt: nowIso(), updatedAt: nowIso(),
                      }),
                      userInput({
                        id: 'lay_new000000001', projectId: '', name: '기본 레이어', kind: 'vector',
                        visible: true, order: 0,
                        style: { color: '#2563eb', opacity: 0.3, strokeWidth: 2, pointRadius: 6 },
                        schema: [], locked: false,
                      }),
                    )
                    await open(id)
                  } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); setPhase('error') }
                }}>
          {has ? '복사하지 않고 새로 시작' : '시작'}
        </button>
      </div>
    )
  }

  return <div className="p-6 text-sm text-neutral-600">불러오는 중…</div>
}
```

- [ ] **Step 4: `init()` 호출 지점을 `StartGate` 로 바꾼다**

먼저 어디서 부르는지 확인한다:

Run: `grep -rn 'init()' src/`

기존 `useEffect(() => { void init() }, [])` 를 지우고 `<StartGate>` 로 감싼다.
`init()` 을 두 곳에서 부르면 `initPromise` 가드가 있어도 프로젝트가 갈린다 — 한 곳만 남겨라.

- [ ] **Step 5: 브라우저 확인 — 이관**

기존 `.env` 에 IndexedDB 데이터가 있는 프로필로 `npm run dev` 를 열고:
1. 안내가 뜨는지, 건수가 맞는지
2. 복사 후 지도에 도형이 그대로 보이는지
3. URL 에 `?p=<uuid>` 가 붙었는지
4. **DevTools → Application → IndexedDB 에 로컬 데이터가 그대로 남아 있는지** (F-81)
5. 새로고침 시 다시 묻지 않는지

- [ ] **Step 6: 타입체크와 커밋**

```bash
npm run typecheck && npm test
git add src/db/migrate-local.ts src/ui/StartGate.tsx src/types.ts src/App.tsx
git commit -F - <<'MSG'
feat: 시작 게이트와 로컬→서버 이관 (F-81)

URL ?p= 또는 localStorage 로 프로젝트를 정하고, 둘 다 없으면 로컬
IndexedDB 건수를 세어 복사를 안내한다. 복사이지 이동이 아니다 —
로컬 원본을 지우지 않는다.

읽기 실패 시 빈 지도가 아니라 오류와 재시도를 보여준다. 빈 지도는
데이터가 지워진 것으로 오인된다.

프로젝트 id 는 절삭하지 않은 uuid 다. uid() 의 48비트는 링크 비밀로
부족하다 — layers·features 는 비밀이 아니라 그대로 uid() 를 쓴다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NnkXdXoX18Pi7gtD9ZFs55
MSG
```

---

### Task 7: 저장 실패를 사용자가 알게 한다

온라인 우선의 가장 큰 위험은 조용한 실패다 (스펙 4.6).

**Files:**
- Modify: `src/db/repo.ts`, `src/ui/TopBar.tsx`

**Interfaces:**
- Consumes: Task 4 의 `SaveState`
- Produces: `retryFlush(): Promise<void>`, `hasUnsaved(): boolean`

- [ ] **Step 1: 지수 백오프 재시도를 `repo.ts` 에 추가**

```ts
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryDelay = 1000

/** 실패한 큐를 다시 보낸다. 성공하면 간격을 되돌린다. */
export async function retryFlush(): Promise<void> {
  if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null }
  try {
    await flush()
    retryDelay = 1000
  } catch {
    retryDelay = Math.min(retryDelay * 2, 30_000)
    retryTimer = setTimeout(() => void retryFlush(), retryDelay)
  }
}

export function hasUnsaved(): boolean {
  return pending.projects.size > 0 || pending.layers.size > 0 || pending.features.size > 0
    || pending.deleteFeatures.size > 0 || pending.deleteLayers.size > 0
}
```

`flush()` 의 catch 안에서 `retryFlush()` 예약을 걸되, `flush()` 자신은 다시 던진다 — 호출자가 알아야 한다.

- [ ] **Step 2: `beforeunload` 경고**

`repo.ts` 에 두지 말고 `TopBar.tsx` 의 이펙트에 둔다 — UI 관심사다.

```tsx
useEffect(() => {
  const onLeave = (e: BeforeUnloadEvent) => {
    if (!hasUnsaved()) return
    e.preventDefault()
    e.returnValue = ''       // 일부 브라우저가 이것을 본다
  }
  window.addEventListener('beforeunload', onLeave)
  return () => window.removeEventListener('beforeunload', onLeave)
}, [])
```

- [ ] **Step 3: 상단바 표시에 실패·재시도 추가**

기존 "저장됨 · 방금" 표시 옆에 상태별 분기를 넣는다. 버튼은 44px 을 레이아웃으로 보장한다.

```tsx
{save.status === 'error' ? (
  <span className="flex items-center gap-2 text-red-600">
    <span className="text-sm">저장 실패</span>
    <button className="min-h-[44px] px-3 rounded border border-red-300"
            onClick={() => void retryFlush()}>다시 시도</button>
  </span>
) : save.status === 'saving' ? (
  <span className="text-sm text-neutral-500">저장 중…</span>
) : (
  <span className="text-sm text-neutral-500">저장됨 · 방금</span>
)}
```

- [ ] **Step 4: 브라우저에서 실패 경로 확인**

1. `npm run dev` 로 열고 도형을 하나 그린다
2. DevTools → Network → **Offline** 으로 바꾼다
3. 제목을 입력한다 → 상단바에 **저장 실패**와 **다시 시도**가 보여야 한다
4. 탭을 닫으려 하면 **경고가 떠야 한다**
5. Online 으로 되돌리고 **다시 시도** → 저장됨으로 바뀌고, 새로고침 후 입력이 남아 있어야 한다

4번이 뜨지 않으면 브라우저가 "사용자 상호작용 없음"으로 무시한 것일 수 있다 —
한 번이라도 클릭한 뒤 다시 시도한다.

- [ ] **Step 5: 타입체크와 커밋**

```bash
npm run typecheck && npm test
git add src/db/repo.ts src/ui/TopBar.tsx
git commit -F - <<'MSG'
fix: 저장 실패를 사용자가 알게 한다

온라인 우선에서 조용한 저장 실패는 데이터를 잃는 경로다. 실패 시
큐를 유지하고 지수 백오프로 재시도하며, 상단바에 실패와 다시 시도를
띄운다. 저장 안 된 것이 남은 채 탭을 닫으려 하면 경고한다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NnkXdXoX18Pi7gtD9ZFs55
MSG
```

---

### Task 8: 다기기 검증과 문서 정리

**Files:**
- Modify: `CLAUDE.md`, `docs/HANDOFF.md`, `README.md`
- Create: `src/__gate.ts` (임시)

**Interfaces:**
- Consumes: Task 1~7 전부
- Produces: 없음 (검증과 문서)

- [ ] **Step 1: 저장 게이트 최종 확인**

```bash
cat > src/__gate.ts <<'EOF'
import { fromProvider } from './persist/persistable'
import { geocoder } from './providers/geocoding'
export const x = fromProvider(geocoder, { a: 1 })
EOF
npx tsc -b --force
rm src/__gate.ts
```

Expected: TS2345

- [ ] **Step 2: RLS 재확인 (Task 1 Step 4 를 실제 프로젝트 uuid 로 다시)**

실제로 쓰는 프로젝트 uuid 로 (1)(3)(4)(5) 를 다시 돌린다. 스키마를 고친 뒤 정책이 남아 있는지 본다.

- [ ] **Step 3: 다기기 동작 — Playwright MCP, 프로필 2개**

CLAUDE.md 의 함정을 지킨다: **정보 패널이 열리면 지도가 리사이즈되므로 화면 좌표를 매번 다시 계산한다.**
사각형·원 도구는 **클릭 → 이동 → 클릭**이다.

1. 프로필 A 로 `http://localhost:5173` → 점 하나, 다각형 하나를 그리고 제목을 넣는다
2. URL 의 `?p=<uuid>` 를 복사한다
3. 프로필 B 로 그 URL 을 연다 → **같은 도형과 제목이 보여야 한다**
4. B 에서 제목을 고치고 도형을 하나 더 그린다
5. A 를 새로고침 → **B 의 변경이 보여야 한다**
6. B 에서 점을 지운다 → A 새로고침 → 지도에서도 사라져야 한다 (동기화 이펙트 고아 제거)
7. 동심원을 만든 뒤 중심을 지운다 → 링도 같이 사라져야 한다 (cascade)

- [ ] **Step 4: 좌표 정밀도 왕복 확인**

검색으로 point 를 만든 뒤(제공자 경계에서 9자리로 절삭됨) 서버 왕복 후에도 지도에 보이는지 확인한다.
Terra Draw 가 9자리 초과를 조용히 거부하는 기존 함정이 되살아나지 않았는지 보는 것이다.

- [ ] **Step 5: 잘못된 링크 확인**

`?p=00000000-0000-0000-0000-000000000000` 으로 열어 **"이 링크의 프로젝트를 찾을 수 없습니다"** 가
보이는지 확인한다. 빈 지도가 보이면 Task 6 Step 3 의 분기가 잘못됐다.

- [ ] **Step 6: stale 문서 정리**

세 곳이 사실과 다르다. 고친다.

`CLAUDE.md`:
- "**git 저장소가 아직 없다.** 커밋을 요청받으면 `git init` 부터 해야 한다." → 삭제.
  저장소는 `https://github.com/rose-brown/post-map` 이고 `main` 을 쓴다.
- "Phase 1~2 는 IndexedDB 만, Phase 3 부터 Supabase + PostGIS" → Phase 3 은 Supabase 를 쓰되
  **PostGIS 는 쓰지 않는다**(jsonb). 스펙 D6 와 전환 시점을 가리키도록 고친다.
- "테스트 러너가 없다" → 순수 함수는 `npm test`(Node 내장)로 돈다. UI·지도는 여전히 Playwright MCP.
- 새 항목: **불변 규칙 4 의 예외에 anon key 추가**, 그리고 "이미 물린 함정"에
  `node --test tests/` 가 `.ts` 를 못 찾는다는 것과 저장 실패 시 큐를 비우지 않는 이유를 넣는다.

`docs/HANDOFF.md`: "ci 커밋 아직 push 안 됨"·"workflow 스코프 없음"은 해결됐다. 현재 상태로 고친다.

`README.md`: `.env` 항목에 `VITE_SUPABASE_URL`·`VITE_SUPABASE_ANON_KEY` 를 추가하고,
비밀 링크의 성질(링크를 아는 사람이 곧 권한)을 한 줄 적는다.

- [ ] **Step 7: 스펙에 판정 결과 기록**

Task 1 Step 4 의 (5) 결과를 스펙 3절 "미확인 — Storage" 에 한 줄로 적는다.
막혔으면 그렇게, 나열됐으면 어떻게 바꿨는지.

- [ ] **Step 8: 최종 확인과 커밋**

```bash
npm run typecheck && npm test && npm run build
git add CLAUDE.md docs/HANDOFF.md README.md docs/superpowers/specs/2026-09-27-phase3-multidevice-sync-design.md
git commit -F - <<'MSG'
docs: Phase 3 반영 — stale 기록 정리

git 저장소가 없다는 기록, Phase 3 이 PostGIS 를 쓴다는 기록,
테스트 러너가 없다는 기록을 사실에 맞게 고쳤다. 불변 규칙 4 의
예외에 Supabase anon key 를 추가했고, 새로 물린 함정 둘을 남겼다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NnkXdXoX18Pi7gtD9ZFs55
MSG
```

---

## 하지 말 것 (이번 계획 범위 밖)

스펙 7절과 같다. 태스크 중에 하고 싶어지면 멈추고 물어라.

- 로그인·계정·사람 단위 역할 (F-80·F-82·F-83)
- PostGIS geometry·GIST·GIN (D6)
- 오프라인 쓰기·충돌 해결 UI (D2)
- Supabase Realtime — 다른 기기 변경은 새로고침으로 본다
- Edge Function 프록시 (VWorld 검색 키 이전)
- 프로젝트 여러 개 관리 UI (D10)
- Phase 2 기능(테이블 뷰·공간 연산·경로) — 별 계획이 있다
- `db/db.ts`·`db/migrations.ts` 수정 — 이관 원본으로 남긴다
