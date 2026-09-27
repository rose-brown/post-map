# Phase 3 설계 — 다기기 동기화 (Supabase)

- 날짜: 2026-09-27
- 근거: PRD 7 Phase 3, PRD 4.4(로컬↔서버 대응), F-80~F-83, 불변 규칙 1·4
- **PRD 의 Phase 3 을 그대로 하지 않는다.** 목표를 "저장한 데이터를 다른 기기에서도 보고 고친다"
  한 가지로 좁혔고, 그 결과 F-80(로그인)·F-82·F-83(사람 단위 공유·역할)을 **범위에서 뺐다**.
  PRD 와 어긋나는 지점은 2절에 결정과 이유로 남긴다.

## 1. 목표 (완료 기준)

1. PC 에서 작도·입력한 내용이 서버에 저장되고, 폰에서 같은 링크를 열면 그대로 보인다.
2. 폰에서 고친 내용이 서버에 저장되고, PC 에서 새로고침하면 반영된다.
3. 링크(프로젝트 uuid)를 모르면 서버에서 아무 행도 읽히지 않는다 — 정책으로 막히는 것을 실제로 확인한다.
4. 기존에 이 기기 IndexedDB 에 있던 기록을 서버로 **복사**할 수 있고, 복사 후에도 로컬 원본이 남아 있다.
5. 저장이 실패하면 사용자가 그것을 안다. 조용히 실패하지 않는다.
6. 이미지(gallery·files 블록)도 다른 기기에서 보인다.
7. 저장 게이트(불변 규칙 1)가 살아 있다 — `__gate.ts` 자체 점검에서 TS2345 가 난다.

## 2. 확정된 결정

| # | 결정 | 이유 |
|---|---|---|
| D1 | **온라인 우선**. 서버(Supabase)가 진실의 원천, IndexedDB 는 읽기 경로에서 빠진다 | 사용자 선택. 충돌 해결 코드가 사라져 이번 Phase 가 가장 작아진다. 대가는 D2 |
| D2 | **신호가 없으면 새 입력이 막힌다.** 오프라인 쓰기는 이후 Phase | D1 의 직접적 대가. PRD 2.1·2.2 의 현장 사용(지하·건물 안)과 상충한다는 것을 알고 고른 트레이드오프 |
| D3 | **로그인 없음.** 사람 단위 계정·역할(F-80·F-83)을 만들지 않는다 | 사용자 선택. 만들 화면이 없어진다 |
| D4 | 접근 제어는 **비밀 링크** — 프로젝트 uuid 를 URL `?p=` 와 `x-project-id` 헤더로 보낸다 | D3 에서 `auth.uid()` 를 쓸 수 없다. 링크를 아는 기기가 곧 권한 |
| D5 | 프로젝트 id 를 **full uuid** 로 바꾼다. layers·features id 는 기존 `lay_*`/`feat_*` 유지 | 기존 id 는 `crypto.randomUUID().slice(0,12)` = 48비트뿐이라 비밀로 쓸 엔트로피가 부족하다. layers·features 는 비밀이 아니다 |
| D6 | `features.geometry` 는 **jsonb**. PostGIS `geometry(Geometry,4326)`·GIST 를 도입하지 않는다 | PRD 4.4 와 어긋나는 유일한 지점. 공간 연산이 전부 클라이언트 turf(`map/rings.ts`)라 서버가 공간 질의를 한 번도 하지 않는다. 쓰지 않는 인덱스를 위해 GeoJSON↔PostGIS 변환 계층을 만드는 것은 순수 비용. 서버측 공간 질의가 필요해질 때(PRD D-4) 컬럼 타입 변경으로 전환한다 |
| D7 | `features.project_id` 를 **비정규화**한다 | 없으면 RLS 정책마다 `layers` 조회 서브쿼리가 붙는다. 단순 컬럼 비교로 만든다 |
| D8 | `src/db/repo.ts` 의 공개 함수 14개 **시그니처를 유지**하고 내부만 교체한다 | 스토어(380줄)·UI·지도를 손대지 않는다. 저장 게이트도 이 시그니처가 지킨다 |
| D9 | 이미지는 **바이트만 Storage**(경로 `<projectUuid>/<blobId>`), **메타데이터는 Postgres `blobs` 테이블** | 경로만으로는 `StoredBlob.featureId` 관계가 사라져 `getBlob(id)`·고아 정리가 불가능하다. 메타 행을 두면 검증된 헤더 RLS 가 그 관계를 보호한다. 읽기는 URL 을 아는 사람만 — D4 와 같은 모델 |
| D10 | 단일 프로젝트 구조를 유지한다 | `useStore.init()` 이 이미 `firstProjectId()` 로 첫 프로젝트만 쓴다. 프로젝트 전환 UI 가 없다 |
| D11 | 테스트 러너를 새로 들이지 않는다 | CLAUDE.md 의 기존 검증 방식(Playwright MCP + curl) |

## 3. 새로 확인한 사실과 미확인 지점

### 확인됨 — RLS 정책에서 요청 헤더를 읽을 수 있다

Supabase 공식 문서(`guides/api/securing-your-api`)가 **Auth 를 쓰지 않고 anon role 만 쓰는 앱**을 위해
이 패턴을 문서화해 두었다.

```sql
current_setting('request.headers', true)::json->>'x-project-id'
```

그래서 D4 의 비밀 링크를 DB 수준에서 **강제**할 수 있다. uuid 를 모르면 `select *` 를 해도 0건이므로
`projects` 목록 열람이 막힌다. 번들에 anon key 가 공개되어도 uuid 없이는 아무것도 못 읽는다.

### 미확인 — Storage 에도 같은 헤더가 전달되는지

Storage 정책은 `storage.objects` 에 걸고 `storage.foldername(name)[1]` 로 경로 첫 세그먼트를
비교할 수 있다(문서 확인). 그러나 **Storage API 는 PostgREST 가 아닌 별도 서비스**라서
`request.headers` GUC 가 Storage 요청에도 설정되는지는 문서에 없고, 실제 프로젝트 없이 확인할 수 없다.

그래서 D9 는 헤더 검증에 **의존하지 않는** 형태로 둔다.

- 읽기: 경로에 projectUuid 가 들어가므로 URL 을 아는 사람만 접근한다 (D4 와 같은 모델)
- 쓰기: `to anon` 으로 INSERT 만 허용한다. SELECT·UPDATE 를 주지 않으므로 **기존 파일 덮어쓰기는 불가**
- **한계**: 업로드를 프로젝트 단위로 막을 수 없다. 제3자가 용량을 채우는 악용이 가능하다.
  클라이언트에서 **파일당 10MB 상한**을 걸어 완화하고, 구현 중 헤더가 전달되는 것이 확인되면 정책을 조인다.

### 명시된 한계 (D4 의 성질)

1. uuid 를 아는 사람은 누구나 읽고 **쓰고 지운다**. 사람 단위 역할이 없다.
2. uuid 가 URL 에 실려 브라우저 히스토리·referrer 에 남는다. "링크를 아는 사람" 모델의 고유한 성질.
3. 링크가 새면 개별 회수가 불가능하다. 프로젝트 id 교체(전 행 일괄 업데이트)만 가능하며 드문 작업으로 둔다.
4. 사적인 기록을 넣기 전에 로그인 도입을 다시 논의할 지점으로 표시한다.

## 4. 구성 요소

### 4.1 서버 스키마

`src/types.ts` 의 실제 필드를 그대로 옮긴다. 중첩 객체(`style`, `initialView`, `schema`, `derivedFrom`)는
쪼개지 않고 jsonb 로 둔다 — 서버가 그 안을 질의하지 않는다.

```sql
create table public.projects (
  id uuid primary key default gen_random_uuid(),   -- URL·헤더의 비밀 (D5)
  name text not null,
  description text not null default '',
  initial_view jsonb not null,                     -- {lng,lat,zoom,bearing,pitch}
  schema_version int not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table public.layers (
  id text primary key,                             -- lay_xxxxxxxxxxxx
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  kind text not null,                              -- 'vector' | 'file' | 'tile' | 'api'
  visible boolean not null,
  "order" int not null,
  style jsonb not null,                            -- LayerStyle
  schema jsonb not null default '[]',              -- PropertySchemaField[]
  locked boolean not null
);

create table public.features (
  id text primary key,                             -- feat_xxxxxxxxxxxx
  project_id uuid not null references public.projects(id) on delete cascade,  -- D7
  layer_id text not null references public.layers(id) on delete cascade,
  parent_id text references public.features(id) on delete cascade,
  geometry jsonb not null,                         -- D6: PostGIS 아님
  title text not null default '',
  properties jsonb not null default '{}',
  blocks jsonb not null default '[]',
  derived_from jsonb,                              -- {op:'ring', sourceIds, params}
  created_at timestamptz not null,
  updated_at timestamptz not null
);

-- 바이트는 Storage, 메타데이터는 여기 (D9)
create table public.blobs (
  id text primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  feature_id text not null references public.features(id) on delete cascade,
  path text not null,                              -- <projectUuid>/<blobId>
  mime text not null,
  size int not null
);

create index on public.layers (project_id);
create index on public.features (project_id);
create index on public.features (layer_id);
create index on public.features (parent_id);
create index on public.blobs (feature_id);
```

`layers` 에는 `updated_at` 이 없다 — `Layer` 타입에 없기 때문이다. 없는 필드를 만들지 않는다.

FK `on delete cascade` 가 지금 클라이언트에서 하던 cascade 삭제(중심 point → 동심원 링)를
서버에서도 보장한다. 클라이언트 로직(`removeFeature`)은 그대로 두고 이중 안전망으로 쓴다.
`blobs.feature_id` cascade 로 피처를 지우면 메타 행도 사라진다 (Storage 객체는 4.5 참조).

### 4.2 RLS — 4개 테이블에 같은 모양

```sql
alter table public.projects enable row level security;
alter table public.layers   enable row level security;
alter table public.features enable row level security;
alter table public.blobs    enable row level security;

create policy "link scoped" on public.features
for all to anon
using      ( project_id = (current_setting('request.headers', true)::json->>'x-project-id')::uuid )
with check ( project_id = (current_setting('request.headers', true)::json->>'x-project-id')::uuid );
```

`layers`·`blobs` 는 같은 형태, `projects` 는 `id =` 로 비교한다.

### 4.3 `src/db/supabase.ts` (새 파일)

```ts
createClient(url, anonKey, { global: { headers: { 'x-project-id': projectId } } })
```

프로젝트 uuid 가 정해진 뒤에 클라이언트를 만들어야 하므로, 모듈 최상단 상수가 아니라
**uuid 를 받아 클라이언트를 만드는 함수**로 둔다.

`VITE_SUPABASE_URL` · `VITE_SUPABASE_ANON_KEY` 는 번들에 들어간다 — **불변 규칙 4 의 새 예외**다.
anon key 는 공개를 전제로 설계되어 RLS 가 실제 방어선이라는 것을 코드 주석에 남긴다
(규칙 4 가 "예외는 이유를 주석에 남긴다"고 정해 두었다).

### 4.4 프로젝트 식별 흐름

1. URL `?p=<uuid>` 가 있으면 그것을 쓴다.
2. 없으면 `localStorage` 의 마지막 uuid 를 쓰고 `history.replaceState` 로 URL 에 넣는다.
   **이게 없으면 링크 분실 = 데이터 접근 불가**다.
3. 둘 다 없으면 로컬 IndexedDB 에 데이터가 있는지 본다 → 있으면 이관 안내(4.5), 없으면 새 프로젝트 생성.
4. 정해진 uuid 는 항상 `localStorage` 에 기록한다.

### 4.5 이관 (F-81)

4.4 의 3번에서만 시작한다.

1. 안내: "이 기기에 기록 N건이 있습니다. 서버로 복사할까요?"
2. 복사 순서는 FK 때문에 고정: `projects`(새 uuid) → `layers` → `features` → 이미지
   (이미지는 Storage 업로드 후 `blobs` 메타 행 삽입 — 순서가 반대면 경로가 없는 행이 남는다)
3. **복사다. 실패해도 IndexedDB 를 건드리지 않는다** (F-81)
4. 성공 시 `meta` 에 이관 완료 플래그와 새 uuid 를 기록해 재안내를 막는다
5. 실패 시 부분 복사가 남으면 `projects` 행 하나만 삭제한다 — FK cascade 로 하위 행이 전부 정리된다

**Storage 객체 고아 문제**: FK cascade 는 `blobs` 메타 행만 지우고 Storage 객체는 남긴다.
그래서 `repo.ts` 의 피처·레이어 삭제 경로에서 **해당 blob 들을 먼저 지운다**(Storage → 메타 행).
이관 실패로 `projects` 를 지우는 경우에만 Storage 객체가 남을 수 있고, 이는 경로 접두사가
버려진 uuid 라 접근 불가능한 잔여물로 둔다 — 알려진 한계로 기록한다.

### 4.6 오류 처리

온라인 우선의 가장 큰 위험은 **조용한 저장 실패**다. `onSaveState()` 가 만드는 상단바 표시에 실패 상태를 더한다.

- 쓰기 실패 → 상단바에 실패 표시 + 지수 백오프 재시도. 실패한 배치는 메모리에 유지
- 재시도 대기 중 탭을 닫으려 하면 `beforeunload` 경고. 없으면 사용자는 잃은 줄 모른다
- 시작 시 읽기 실패 → 빈 지도가 아니라 오류 + 재시도 버튼. 빈 지도는 데이터가 지워진 것으로 오인된다
- 없는 uuid → "이 링크의 프로젝트를 찾을 수 없습니다"

## 5. 바뀌는 파일

| 파일 | 변경 |
|---|---|
| `src/db/supabase.ts` | **새 파일**. uuid 를 받아 클라이언트 생성 |
| `src/db/repo.ts` | 내부를 Dexie → Supabase 로. **공개 시그니처 14개 유지** |
| `src/db/project-link.ts` | **새 파일**. 4.4 의 uuid 결정 + `localStorage` |
| `src/db/migrate-local.ts` | **새 파일**. 4.5 이관 |
| `src/store/useStore.ts` | `init()` 이 uuid 를 받도록. 그 외 손대지 않는다 |
| `src/ui/TopBar.tsx` | 저장 상태 표시에 실패·재시도 추가 |
| `src/types.ts` | `SCHEMA_VERSION` 유지. Project id 생성만 full uuid 로 |
| `.env.example` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` 추가 |
| `supabase/schema.sql` | **새 파일**. 4.1 스키마 + 4.2 정책. 저장소에 두어 재현 가능하게 한다 |
| `db/db.ts`, `db/migrations.ts` | **건드리지 않는다.** 이관 원본으로 남는다 |
| `ui/Blocks.tsx`, `map/*` | **건드리지 않는다.** blob 시그니처가 유지되므로 |

## 6. 검증

```bash
npm run typecheck
```

**저장 게이트 생존** — CLAUDE.md 의 자체 점검을 그대로. `src/__gate.ts` 를 넣고
`npx tsc -b --force` 에서 **TS2345 가 나야 정상**이다.

**RLS 가 실제로 막는지** — 정책을 썼다고 막히는 게 아니라 막히는 것을 봐야 한다.

```bash
# 헤더 없이 → [] 여야 한다
curl -s "$URL/rest/v1/projects?select=*" -H "apikey: $ANON"
# 틀린 uuid → [] 여야 한다
curl -s "$URL/rest/v1/features?select=*" -H "apikey: $ANON" \
     -H "x-project-id: 00000000-0000-0000-0000-000000000000"
# 맞는 uuid → 행이 나와야 한다
curl -s "$URL/rest/v1/features?select=*" -H "apikey: $ANON" -H "x-project-id: $P"
```

**다기기 동작** (Playwright MCP, 브라우저 프로필 2개) — A 에서 작도 → B 에서 같은 링크 →
같은 도형이 보임 → B 에서 수정 → A 새로고침 시 반영. CLAUDE.md 의 함정을 지킨다:
정보 패널이 열리면 지도가 리사이즈되므로 **화면 좌표를 매번 다시 계산**한다.

**이관** — IndexedDB 에 데이터를 넣고 이관 → 서버 건수 일치 + **로컬이 그대로 남아 있는지** 확인.

**저장 실패 표시** — DevTools 로 오프라인 전환 후 입력 → 상단바에 실패가 보이고,
탭을 닫으려 하면 경고가 뜨는지 확인.

## 7. 하지 말 것 (이번 범위 밖)

- **로그인·계정** (F-80). 사람 단위 역할(F-83)도 없다 — D3·D4
- **사람 단위 공유·초대** (F-82). 공유는 링크를 보내는 것이다
- **PostGIS** geometry 컬럼·GIST·GIN — D6
- **오프라인 쓰기**·충돌 해결 UI — D2
- **Supabase Realtime**. 다른 기기의 변경은 새로고침으로 본다. 실시간 반영은 별건
- **Edge Function 프록시** (VWorld 검색 키 이전). 별건으로 남긴다
- 프로젝트 여러 개 관리 UI — D10
- 테스트 러너 도입 — D11
