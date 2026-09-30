# 필터 버튼 설계 (아실·네이버식 버튼 선택)

- 날짜: 2026-09-30
- 근거: 사용자 요청 — 아실(asil.kr)·네이버 부동산의 버튼형 필터를 참고해 "버튼으로 선택 가능하게". 선행 작업 `2026-09-30-list-filter-design.md`(목록 필터, F-71 일부) 위에 쌓는다.
- 참고 사이트 실측 (2026-09-30): 두 곳 모두 지도 위 칩 줄 → 팝오버. 아실 팝오버는 범위 슬라이더 + **미리 정한 버튼**(전체·50세대~·100세대~…, ~2년·5년~…), 네이버는 슬라이더 + 체크형 칩.
- 사용자 결정: 배치는 **B — 목록 패널(모바일은 목록 바텀시트) 안에 항목별 버튼 묶음** (컴패니언에서 웹·모바일 모두 B). PC 우측 패널 접기 **넣는다**. 버튼 값은 **레이어 스키마 필드의 `presets`**. 나머지는 "추천으로 모두 진행".

## 1. 목표 (완료 기준)

1. 목록 패널의 필터 영역에 항목별 버튼 묶음이 뜬다: 진입가 · 총세대수 · 입주년차 · 평당시세 · 역까지 · 선릉·여의도·시청까지 (월간선도50 원본 레이어 6개를 켰을 때).
2. 버튼을 누르면 그 항목 조건이 버튼 값으로 바뀌고(항목당 버튼 하나), 켜진 버튼을 다시 누르면 그 항목 조건이 빠진다. 목록·지도가 기존 필터 경로로 같이 걸러진다.
3. 처음에는 항목 3개만 보이고 `▾ 더보기 (N)` 로 나머지를 편다. 기존 조건 편집 행은 `직접 입력 ›` 아래로 들어간다.
4. 모바일: 버튼을 고른 뒤 바텀시트를 접힘(88px)으로 내리면 지도가 크게 보이고 필터는 유지된다 (기존 3단 스냅).
5. PC: 우측 패널을 접고 펼 수 있다. 접힌 상태에서 필터가 켜져 있으면 펼침 버튼에 점. 도형을 선택하면 패널이 자동으로 펼쳐진다.
6. 월간선도50 원본 단지에 숫자 속성 `entryPrice`(진입가, 억)·`ageYears`(입주년차, 년)가 생기고 스키마에 들어가 정보 페이지에 숫자로 보인다.

## 2. 확정된 결정

| # | 결정 | 이유 |
|---|---|---|
| E1 | 버튼 값은 `PropertySchemaField.presets?: FilterPreset[]` (`{ label, op, value }`). `src/` 에는 값이 없다 | 불변 규칙 6. 스키마는 jsonb 라 서버 변경 없음 (`mappers.ts` 가 그대로 넘긴다) |
| E2 | 버튼 묶음은 **보이는 레이어** 필드 중 `presets` 가 있는 number 필드만. 같은 key 는 `fieldFor`(보이는 정의 우선) | 기존 D2·D6 과 같은 규칙. 사용자 레이어는 버튼 없이 직접 입력만 |
| E3 | 필터 상태는 여전히 `filters: FilterCond[]` 하나. 버튼은 그것을 만드는 입구일 뿐 — 버튼 켜짐 = 같은 key·op·value 조건이 있음 | 진실의 원천 하나. 직접 입력으로 같은 값을 넣어도 버튼이 켜진다 |
| E4 | ~~항목당 버튼 하나~~ → **2026-09-30 사용자 요청으로 여러 개**: 버튼 조건에 `preset: true` 를 붙이고, 같은 key 의 버튼 조건끼리는 **OR**, 그 밖(다른 key·직접 입력)은 AND. 버튼을 켜면 같은 key 의 직접 입력 조건은 지우고, 켜진 버튼을 누르면 그 버튼만 끈다. 직접 입력에서 고친 버튼 조건은 `preset` 을 떼어 AND 로 돌린다 | 아실처럼 항목당 하나. "1000~" 과 "2000~" 이 AND 로 겹치는 상태를 버튼으로 만들지 않는다 |
| E5 | 버튼 값·라벨 표 (8절)는 **`scripts/presets/presets.ts` 하나**에 둔다. `scripts/presets/run.ts <projectId>` 가 프로젝트 모든 레이어 스키마에서 key 가 맞는 필드에 `presets` 를 **덮어쓴다** (다른 속성은 유지) | lead50 `mergeSchema` 는 기존 필드 객체를 통째로 유지해서(D7) SCHEMA 에 넣기만 하면 기존 레이어에 안 들어간다. 사본 레이어(TOP9·진입가·교통)도 key 로 같이 맞는다. 앱에 프리셋 편집 UI 가 없으므로 스크립트가 소유 |
| E6 | `lead50/run.ts` 끝에서 presets 동기화를 부른다(top9·price 다음). transit 은 수동 실행이라 문서에 "transit 뒤 presets 도 다시" 를 남긴다 | 새로 만든 레이어에도 버튼이 들어가게 |
| E7 | `entryPrice` = 진입가(평형별 최신 거래 중 최저, 기존 `entryGroup`)를 **억, 소수 둘째 자리 내림** (`Math.floor(만원/100)/100`, 2026-09-30 반올림에서 바꿈 — 최종 검토 M-4). 스키마 `{ key:'entryPrice', label:'진입가 금액', type:'number', unit:'억' }`, SCHEMA 에서 `entryTrade` 바로 뒤 | 버튼 경계(3·5·6.5·8·12억)가 기존 진입가 구간 레이어(D13)와 같아야 한다 — 억 둘째 자리면 6.5억 경계가 틀어지지 않는다 |
| E8 | `ageYears` = `completion` 문자열의 **`(N년차)` 의 N** (KB 가 준 년차 그대로). 형식이 아니면 키 없음. 스키마 `{ key:'ageYears', label:'입주년차', type:'number', unit:'년차' }`, `completion` 바로 뒤 | 실데이터(2026-09-30, 3,288 전부)가 `"03년 08월 (24년차)"` 형식이다 — YYYYMM 이 아니다. KB 가 기준월로 이미 센 값이라 정보 페이지 준공 문자열과 숫자가 어긋나지 않는다 |
| E9 | `entryPrice`·`ageYears` 계산은 **`price.ts` 의 `priceRows`** 가 원본을 다시 쓸 때 같이 한다 (KB·국토부 호출 없음). 진입가 사본도 원본 속성을 그대로 가져가므로 같이 갱신된다 | 이미 거래 블록으로 원본을 다시 쓰는 유일한 경로. TOP9·교통 사본은 각 스크립트를 다시 돌려야 새 속성이 붙는다 (필터 용도는 원본 6개라 막지 않는다) |
| E10 | 처음 보이는 버튼 묶음은 **스키마 순서상 첫 3개**, 나머지는 `▾ 더보기 (N)`. 펼침 상태는 컴포넌트 로컬 | 순서 = 진입가 금액 · 총세대수 · 입주년차 (SCHEMA 순서) → 사용자가 모바일 목업에서 본 것과 같은 규모 |
| E11 | 기존 조건 편집 행(필드·연산자·값)은 `직접 입력 ›` 을 누르면 편다. 조건이 버튼으로 표현되지 않는 것(값이 프리셋과 다름·프리셋 없는 필드·적용 안 됨)이 하나라도 있으면 처음부터 펼친다 | 버튼으로 안 보이는 조건이 숨으면 "왜 걸러지지?" 가 된다 |
| E12 | PC 우측 패널 접기: `App` 상태 `listOpen`(기본 true). 지도 오른쪽 위(내비게이션 컨트롤 왼쪽)에 `패널 ▶` / `◀ 목록` 버튼, 접힌 상태 + 활성 조건이면 점. 선택이 생기면 자동으로 편다 | 좌측 `◀ 패널` 과 같은 방식. 접힌 채 도형을 누르면 정보 페이지가 안 보이는 문제를 막는다 |
| E13 | 기존 사소한 문제 중 이번 변경과 겹치는 M-3(레이어 다 끄고 조건 모두 지우면 열린 패널을 못 닫음)은 같이 고친다: `disabled={!canFilter && !filterOpen}` | 버튼 묶음이 들어가면 패널이 자주 열린 채 남는다 |

## 3. 구조

### 3.1 타입 (`src/types.ts`, `src/filter.ts`)

```ts
// types.ts — FilterOp 를 filter.ts 에서 옮긴다 (스키마 타입이 참조하므로). filter.ts 는 re-export.
export type FilterOp = 'gte' | 'lte' | 'between' | 'contains'
export interface FilterPreset { label: string; op: FilterOp; value: string | [string, string] }
export interface PropertySchemaField { …기존…; presets?: FilterPreset[] }
```

`src/filter.ts` 에 순수 함수 추가:

```ts
/** 보이는 레이어 필드 중 presets 가 있는 number 필드 (filterFields 순서). */
export function presetFields(layers: Layer[]): PropertySchemaField[]
/** 이 버튼이 켜져 있나 — 같은 key·op·value 조건이 있다. */
export function presetOn(conds: FilterCond[], key: string, p: FilterPreset): boolean
/** E4. 켜져 있으면 그 key 조건 전부 제거, 아니면 key 조건을 지우고 버튼 조건 하나 추가. id 는 호출자가 준다. */
export function togglePreset(conds: FilterCond[], key: string, p: FilterPreset, id: string): FilterCond[]
/** E11. 버튼으로 표현되지 않는 조건이 있나 (presets 없는 필드 / 어느 버튼과도 안 같음 / condProblem 있음). */
export function hasManualConds(conds: FilterCond[], visibleFields: PropertySchemaField[]): boolean
```

### 3.2 UI

- `ui/FilterBar.tsx` 의 `FilterPanel` 을 **버튼 묶음 + 직접 입력** 으로 재구성한다. 버튼 묶음 컴포넌트 `PresetGroups` 를 같은 파일에 둔다.
  - 한 묶음 = `label`(+unit 없이) 한 줄, 그 아래 버튼들(`flex-wrap`). 켜진 버튼은 `bg-brand text-white`.
  - 모바일(`embedded`) 버튼은 `touch-target`.
- `ui/FeatureList.tsx`: 변화 최소 — `FilterPanel` 호출 그대로, 토글 disabled 조건만 E13.
- `App.tsx`: PC 우측 `aside` 폭 `w-[360px]` ↔ `w-0 overflow-hidden` (좌측과 같은 전환), 토글 버튼, 선택 시 자동 펼침. 모바일 분기는 바꾸지 않는다.
- 지도 크기 변화: 좌측 패널 전환과 같은 경로라 MapLibre 가 컨테이너 크기를 따라가는지 브라우저에서 확인 (안 되면 `map.resize()` 를 전환 끝에 부른다 — 확인 전 추측으로 넣지 않는다).

### 3.3 스크립트

| 파일 | 변경 |
|---|---|
| `scripts/presets/presets.ts` (새) | 8절 표. `withPresets(schema: PropertySchemaField[]): PropertySchemaField[]` — key 가 표에 있는 필드에 `presets` 덮어쓰기, 나머지 그대로 (순수) |
| `scripts/presets/run.ts` (새) | `syncPresets(sb, projectId, dryRun)` — 레이어 전부 읽어 스키마가 바뀐 것만 PATCH. CLI `node scripts/presets/run.ts <projectId> [--dry-run]` |
| `scripts/lead50/build.ts` | SCHEMA 에 `entryPrice`·`ageYears`, 순수 함수 `entryPriceOf(g)`·`ageYearsOf(completion)`, `priceRows` 가 두 속성도 채운다 (값이 없으면 키 삭제) |
| `scripts/lead50/run.ts` | 끝에서 `syncPresets` 호출 (E6) |

## 4. 오류 처리

- `ageYearsOf`: `completion` 에 `(N년차)` 가 없으면 undefined → 키를 넣지 않는다 (PRD 4.3).
- `syncPresets`: 레이어 PATCH 실패 시 즉시 종료 코드 1 (다른 스크립트와 같음). `--dry-run` 은 바뀔 레이어 이름·필드 수만 출력.
- 프리셋 값이 필드 타입과 안 맞는 경우(표 오류)는 `activeConds` 가 이미 거른다 — 버튼을 눌러도 조건이 "적용 안 됨"으로 보인다.

## 5. 테스트

- `tests/filter.test.ts`: `presetFields`(보이는 레이어·presets 있는 number 만·순서), `presetOn`(between 배열 비교 포함), `togglePreset`(다른 key 보존·같은 key 여러 개 제거·켜진 것 끄기), `hasManualConds`.
- `tests/lead50.test.ts`: `entryPriceOf`(6.85억 → 6.85, 9,500만 → 0.95), `ageYearsOf`(`"03년 08월 (24년차)"` → 24, `"26년 01월 (1년차)"` → 1, 형식 아님·undefined → undefined), `priceRows` 가 두 속성을 채움, `SCHEMA` 순서.
- `tests/presets.test.ts`: `withPresets` 가 key 맞는 필드만 덮어쓰고 label·unit 등 사용자 변경 유지, 표의 모든 op 가 `opsFor('number')` 안.
- 브라우저 (dev, 1280×800 · 390×844): 버튼 → 개수가 직접 입력 같은 조건과 같음, 켜진 버튼 다시 → 해제, 더보기, 직접 입력 자동 펼침(E11), 모바일 시트 접힘에서 지도·필터 유지, PC 우측 패널 접기·점·선택 시 자동 펼침·지도 폭 따라감.
- 실데이터: `node scripts/lead50/price.ts <id> --dry-run` → 실행, `node scripts/presets/run.ts <id> --dry-run` → 실행. 진입가 버튼 개수가 진입가 구간 레이어 개수(468/634/444/329/523/810)의 누적과 맞는지 대조 — 구간 레이어는 `[하한, 상한)` 이고 버튼은 `이하`(경계 포함)라 경계값(정확히 3억 등) 단지 수만큼 차이 날 수 있다. 그 수를 따로 세어 설명되면 통과.

## 6. 범위 밖

- 지도 위 칩 줄·팝오버(A·C 안), 범위 슬라이더, 체크형 칩(네이버 "세대당 주차")
- 텍스트 필드 버튼(지역 69개), 조건 저장
- 앱 안 프리셋 편집 UI
- TOP9·교통 사본에 새 숫자 속성 붙이기 (각 스크립트 재실행 몫)

## 7. 실데이터 쓰기

`price.ts`·`presets/run.ts` 는 사용자 Supabase 프로젝트(`92e81c2e-…`)에 쓴다. 스크립트 소유 키(`entryPrice`·`ageYears`·스키마 `presets`)만 바꾸고 사용자 키는 보존한다(D7). 항상 `--dry-run` 을 먼저 본다.

## 8. 버튼 값 표 (`scripts/presets/presets.ts`)

| key | 라벨 → 조건 |
|---|---|
| `entryPrice` (억) | **구간** (2026-09-30 사용자 요청으로 누적 → 구간): ~3억 `lte 2.99` · 3~5억 `between 3~4.99` · 5~6.5억 · 6.5~8억 · 8~12억 · 12억~ `gte 12`. 값은 억 둘째 자리 **내림**이라 진입가 구간 레이어 `[하한, 상한)` 과 정확히 같다 (E7 수정) |
| `households` (세대) | **구간**: ~300 `lte 299` · 300~500 `between 300~499` · 500~1000 · 1000~2000 · 2000~3000 · 3000~ `gte 3000` |
| `ageYears` (년차) | ~5년 `lte 5` · ~10년 · ~15년 · ~20년 · 20년~ `gte 20` · 30년~ `gte 30` |
| `pricePerPyeong` (만원) | ~1천 `lte 1000` · ~2천 · ~3천 · ~4천 · ~6천 · 6천~ `gte 6000` (분포 2026-09-30: 중앙 2,357 · 상위25% 4,037 · 상위10% 6,010) |
| `stationDistance` (m) | 300m 이내 `lte 300` · 500m · 800m · 1km `lte 1000` |
| `minSeolleung`·`minYeouido`·`minCityHall` (분) | 20분 `lte 20` · 30분 · 45분 · 1시간 `lte 60` |
