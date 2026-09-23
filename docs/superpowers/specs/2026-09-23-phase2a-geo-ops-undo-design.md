# Phase 2-A 설계 — 면적·길이, 공간 연산, Undo/Redo

- 날짜: 2026-09-23
- 근거: `docs/prompts/03-Phase2-...` 완료 기준 3·4·5, 구현 범위 2(공간 연산), PRD F-11·F-21~F-27
- Phase 2 는 2-A ~ 2-E 로 쪼개 진행한다. 이 문서는 **2-A** 만 다룬다.
  (2-B 테이블 뷰, 2-C 파일 업로드·좌표계, 2-D 배경지도, 2-E 경로)

## 1. 목표 (완료 기준)

1. polygon·line 을 골라 거리 버퍼를 걸면 새 도형이 생긴다. 음수면 축소, 결과가 비면 안내 후 취소.
2. polygon 두 개로 합집합·교차·차집합을 실행하면 결과가 새 피처로 저장되고 원본은 남는다.
   결과가 없으면 `겹치는 영역이 없습니다`(교차) / `남는 영역이 없습니다`(차집합) 안내 후 취소.
3. 연산은 확정 전에 점선 미리보기로 보이고 `확정 / 취소` 할 수 있다. 이탈하면 파기된다.
4. 정보 페이지에 polygon 은 `㎡ · 평 · ㎢`, line 은 `m · km` 가 자동 표시되고 편집하면 갱신된다.
5. Ctrl+Z / Ctrl+Shift+Z 와 툴바 버튼으로 **지오메트리 변경**을 되돌리고 다시 할 수 있다. 스택 상한 50.
6. 연산 결과 정보 페이지에 `생성 방식: buffer(공원, 300m)` 이 보인다.

## 2. 확정된 결정

| # | 결정 | 이유 |
|---|---|---|
| D1 | Undo 대상은 **지오메트리만**: 도형 생성·삭제·꼭짓점/이동 편집·연산 결과 생성·동심원 반경 변경 | F-11 은 "작도·편집·연산". 속성·블록 텍스트는 입력칸 기본 Ctrl+Z 에 맡긴다 |
| D2 | 연산 결과는 **일반 도형**이다. `derivedFrom` 은 출처 메타데이터일 뿐, 원본과 연동(재계산·cascade)하지 않는다 | "새 Feature, 원본 보존". 결과에 다시 연산을 걸 수 있다 |
| D3 | 이항 연산은 **정보 페이지에서 시작 → 지도에서 대상 하나를 누른다**. 차집합은 `현재 도형 − 누른 도형` | 터치에서 동작, 순서가 모호하지 않음, 다중 선택 상태 불필요 |
| D4 | 합집합은 **한 번에 2개**. 3개 이상은 결과에 다시 합집합 | D3 의 대가. PRD F-22 "2개 이상"을 좁힌다 |
| D5 | 결과는 **첫 번째 도형(A)의 레이어**에 만든다. 제목은 생성 방식 문자열 (`union(공원, 놀이터)`) | 목록에서 "제목 없음"으로 뭉치지 않게 |
| D6 | 테스트 러너를 새로 들이지 않는다. 검증은 Playwright MCP 로 브라우저를 직접 몬다 | CLAUDE.md 의 기존 검증 방식 |

## 3. 새로 확인한 제약 — Terra Draw 가 담지 못하는 도형

`terra-draw` 1.35 의 polygon 검증 함수는 `coordinates.length !== 1` 이면 `Feature has holes` 로,
`type !== 'Polygon'` 이면 `Feature is not a Polygon` 으로 **거부한다** (dist 소스에서 확인).
그런데 공간 연산 결과는 자주 이렇게 나온다.

- 떨어진 두 polygon 의 합집합 → `MultiPolygon`
- 큰 도형에서 안쪽 도형을 뺀 차집합 → 구멍 있는 `Polygon`
- 오목한 도형의 음수 버퍼 → `MultiPolygon`

D2(결과는 일반 도형)를 유지하되, **Terra Draw 가 담을 수 있는 도형과 없는 도형을 나눈다.**

- `isEditable(geometry)` = `Point` · `LineString` · 구멍 없는 `Polygon`. 이것만 Terra Draw 에 올린다.
- 나머지(`MultiPolygon`, 구멍 있는 `Polygon`, `MultiLineString` 등)는 새 MapLibre GeoJSON 소스
  **`shapes`** 로 그린다 (fill + line). 클릭하면 선택되고 정보 페이지가 열리지만 꼭짓점 편집은 없다.
  정보 페이지에 `이 도형은 꼭짓점 편집을 지원하지 않습니다` 한 줄을 띄운다.
- 이 도형들도 연산의 입력이 될 수 있다 (버퍼·이항 연산 모두 Polygon|MultiPolygon 을 받는다).

동기화 이펙트(`MapView.tsx`)의 필터는 `!f.derivedFrom` → `isEditable(f.geometry) && f.derivedFrom?.op !== 'ring'`
으로 바뀐다. 기존 이미 물린 함정(소수점 9자리 초과 거부)도 여기 걸린다 — **모든 연산 결과는
`lib/geo` 경계에서 소수점 9자리로 절삭**한다.

## 4. 구성 요소

### 4.1 `src/lib/geo/` — 순수 함수 (UI·스토어 의존 없음)

| 파일 | 내용 |
|---|---|
| `rings.ts` | `src/map/rings.ts` 를 이동 (`buildRings`, `ringLabelPoints`, `radiusLabel`). 내용 변경 없음 |
| `measure.ts` | `area(g): number`(㎡, 측지) · `length(g): number`(m, 측지) · `formatArea(m2)` → `1,240㎡ · 375평 · 0.0012㎢` · `formatLength(m)` → `850m · 0.85km`. 평 = ㎡ ÷ 3.3058 |
| `ops.ts` | `buffer(g, meters)` · `union(a, b)` · `intersect(a, b)` · `difference(a, b)` → `OpResult` |
| `editable.ts` | `isEditable(g)` — 3절의 판정 |

```ts
type OpResult = { ok: true; geometry: Polygon | MultiPolygon } | { ok: false; reason: string }
```

- Turf 7 (`@turf/turf` 이미 의존성에 있음). 불변 규칙 3 — 측지 계산만.
- `buffer` 는 LineString·Polygon·MultiPolygon 만 받는다 (point 버퍼는 동심원이 이미 한다).
  Turf 가 `undefined` 또는 빈 좌표를 주면 `{ ok: false, reason: '버퍼 결과가 비어 있습니다' }`.
- `union` 은 null 이 날 수 없지만, `intersect`·`difference` 의 null 은 1절의 안내 문구로 돌려준다.
- 모든 성공 결과는 소수점 9자리 절삭 후 반환한다.

### 4.2 타입 (`src/types.ts`)

```ts
derivedFrom?: {
  op: 'ring' | 'buffer' | 'union' | 'intersect' | 'difference'
  sourceIds: string[]          // difference 는 [A, B] 순서가 의미를 가진다
  params: Record<string, unknown>  // buffer: { distance: number }
}
```

`op` 유니온만 넓어지고 기존 데이터는 그대로 유효하므로 **스키마 버전을 올리지 않는다.**
(IndexedDB 마이그레이션 함수 작성은 레이어 종류가 늘어나는 2-C 에서 한다.)

### 4.3 Undo/Redo — `src/store/history.ts`

스냅샷이 아니라 **변경 기록**이다. 전체 `features` 스냅샷으로 되돌리면 그 사이 다른 도형에 입력한
속성까지 되돌아가 D1 과 어긋난다.

```ts
type Change =
  | { kind: 'create'; features: Feature[] }                  // undo = 삭제
  | { kind: 'delete'; features: Feature[]; blobs: StoredBlob[] } // undo = 복원
  | { kind: 'geometry'; id: string; before: Geometry; after: Geometry }
interface Entry { label: string; changes: Change[] }
```

- `past: Entry[]`(상한 50, 넘치면 오래된 것부터 버림), `future: Entry[]`. 새 기록이 생기면 `future` 를 비운다.
- 스택은 메모리에만 있다. 새로고침하면 사라진다.
- **기록 지점** (스토어 액션 안에서만):
  - 작도 완료(`addFeatureFromGeometryWithId`), 검색으로 만든 point(`addFeatureFromGeometry`) → `create`
  - `removeFeature` → `delete` (cascade 로 지워지는 링 포함)
  - 연산 확정 → `create`
  - `setRings` → 한 Entry 에 옛 링 `delete` + 새 링 `create`
  - 편집 → `geometry`. 아래 "드래그 합치기" 참조
- **드래그 합치기**: Terra Draw 는 드래그 중 `change(update)` 를 연속으로 쏜다. 매번 기록하면 스택이 넘친다.
  첫 `change` 에서 그 id 의 편집 전 지오메트리를 `editBaseline` 에 잡아 두고, `finish` 이벤트의
  `context.action` 이 `draw` 가 아닐 때(`dragCoordinate`·`dragFeature`·`insertMidpoint`·`deleteCoordinate`·
  `dragCoordinateResize`) `geometry` 기록 하나로 확정한다. `origin: 'api'` 인 `change` 는 무시한다
  (Undo 가 지오메트리를 되밀 때 나오는 이벤트라 기준선을 오염시킨다).
  중심 point 를 끄는 동안 다시 그려지는 링은 기록하지 않는다 — Undo 로 중심이 돌아오면 반경으로 다시 계산한다.
- **Blob 보존**: `repo.flush()` 는 피처를 지울 때 blobs 도 함께 지운다. 그래서 `removeFeature` 는 지우기 전에
  블록의 `refs` 로 Blob 을 읽어 `delete` 기록에 담는다. 이 읽기 트랜잭션은 500ms 뒤 flush 의 쓰기
  트랜잭션보다 먼저 열리므로 지워지기 전 값을 읽는다. Undo 는 `putBlob` 후 `saveFeature`.
- **적용**: undo/redo 는 스토어 `features` 와 `repo`(save/delete) 를 함께 고친다. 지워진 도형이 선택돼 있었으면
  선택을 푼다. 기록 속 도형의 레이어가 이미 없으면 그 변경은 건너뛴다.
- **레이어 삭제 시 스택을 비운다** (레이어 작업은 Undo 대상이 아니고, 남겨 두면 없는 레이어를 가리킨다).
- **지도 반영**: 동기화 이펙트에 세 번째 단계를 더한다 — Terra Draw 에 있는 도형 중 스토어 지오메트리와
  다른 것은 `updateFeatureGeometry` 로 맞춘다. 지금은 추가·고아 제거만 해서, 이게 없으면 편집 Undo 가
  지도에 보이지 않는다.
- **입력**: `Ctrl/⌘+Z`, `Ctrl/⌘+Shift+Z`, `Ctrl+Y`. 포커스가 input·textarea·contenteditable 이면
  가로채지 않는다(입력칸 기본 동작). 지금 `MapView.tsx` 의 `onKey` 는 모드와 무관하게 Terra Draw 자체
  `draw.undo()` 를 부른다. 이 핸들러를 하나로 합쳐 **작도 모드면 `draw.undo()`(마지막 점 제거, F-10),
  `select` 모드면 스토어 `undo()` 만** 부르게 바꾼다 — 두 undo 가 한 키에 같이 돌면 안 된다.
  툴바에 되돌리기·다시 하기 버튼 — 모바일에는 키보드가 없다.

### 4.4 연산 흐름 — 스토어 `pendingOp` + 정보 페이지 + 지도

```ts
pendingOp: null | {
  op: 'buffer' | 'union' | 'intersect' | 'difference'
  sourceId: string
  targetId?: string          // 이항 연산
  distance?: number          // buffer
  result?: OpResult
}
```

`pendingOp` 는 저장하지 않는 화면 상태다.

1. **시작**: 정보 페이지(polygon·line 선택 시)에 `공간 연산` 섹션. 버튼 `버퍼 / 합집합 / 교차 / 차집합`.
   line 에는 버퍼만 보인다. 링은 Terra Draw 에 없어 선택되지 않으므로 대상이 되지 않는다.
2. **버퍼**: 거리(m) 입력칸 (음수 허용). 값이 바뀔 때마다 `ops.buffer` 를 돌려 `result` 갱신.
3. **이항**: 하단 힌트 알약이 `대상 polygon 을 지도에서 누르세요` 로 바뀐다. 이 동안 Terra Draw 를
   `static` 모드(Terra Draw 가 항상 내장, dist 에서 확인)로 둬서 선택이 A 에서 옮겨가지 않게 하고, 지도 클릭을 `getFeaturesAtLngLat` +
   `shapes` 레이어 `queryRenderedFeatures` 로 판정한다. 자기 자신·polygon 이 아닌 도형은 무시한다.
   대상을 고르면 `result` 계산.
4. **미리보기**: 새 MapLibre 소스 `preview` — 점선 윤곽 + 옅은 채움. `result.ok === false` 면 미리보기 없이
   섹션에 `reason` 을 띄우고 `확정` 을 비활성화한다.
5. **확정**: 새 Feature 생성 (D5, `derivedFrom` 기록, `userInput()` — 사용자 도형으로 만든 결과이므로
   저장 게이트를 그대로 통과한다), history `create` 기록, `pendingOp` 비움, 새 도형 선택.
6. **파기**: `취소`, ESC, 선택 변경, 정보 페이지 닫힘 → `pendingOp = null`, Terra Draw 모드 복귀.

### 4.5 정보 페이지 표시

- polygon 계열: `면적 1,240㎡ · 375평 · 0.0012㎢`, line 계열: `길이 850m · 0.85km`. 렌더 시 계산하고 저장하지 않는다
  (지오메트리에서 언제든 다시 나오는 값이다).
- `derivedFrom` 이 있고 `op !== 'ring'` 이면 `생성 방식: buffer(공원, 300m)`. 원본 이름은 현재 제목, 없으면 id 앞부분.
  원본이 지워졌으면 `(삭제됨)`.
- 편집 불가 도형이면 3절의 안내 한 줄.

## 5. 바뀌는 파일

| 파일 | 변경 |
|---|---|
| `src/lib/geo/{rings,measure,ops,editable}.ts` | 신규 (`rings` 는 이동) |
| `src/map/rings.ts` | 삭제, import 경로 갱신 |
| `src/types.ts` | `derivedFrom.op` 확장 |
| `src/store/history.ts` | 신규 — 스택과 Change 적용 |
| `src/store/useStore.ts` | 기록 지점, `undo`/`redo`/`canUndo`/`canRedo`, `pendingOp` 액션, 레이어 삭제 시 스택 비움 |
| `src/map/MapView.tsx` | 동기화 필터·지오메트리 갱신 단계, `shapes`·`preview` 소스, 드래그 합치기, 대상 선택 모드, 단축키 핸들러 통합 |
| `src/ui/InfoPage.tsx` | 측정 표시, 생성 방식, 공간 연산 섹션 |
| `src/ui/Toolbar.tsx` | 되돌리기·다시 하기 버튼 |

## 6. 검증 (Playwright MCP)

각 항목을 브라우저에서 직접 확인하고 스크린샷을 `docs/screenshots/phase2a-*.png` 로 남긴다.

1. polygon 버퍼 +100m → 미리보기 점선 → 확정 → 새 도형 + `생성 방식` 표시. -10000m → 안내, 확정 비활성
2. line 버퍼 50m → 결과 polygon
3. 떨어진 두 polygon 합집합 → MultiPolygon 이 `shapes` 로 그려지고 클릭 시 정보 페이지가 열린다
4. 겹치지 않는 두 polygon 교차 → `겹치는 영역이 없습니다`
5. 큰 polygon − 안쪽 polygon 차집합 → 구멍 난 도형, 면적이 구멍만큼 줄어든다
6. 면적 값을 Turf 로 따로 계산한 값과 대조, 꼭짓점을 끌면 표시가 바뀐다
7. 작도 → 꼭짓점 드래그 → 삭제 순으로 한 뒤 Ctrl+Z 세 번: 복원 → 원래 모양 → 사라짐. Ctrl+Shift+Z 로 재적용.
   드래그 한 번이 Undo 한 번으로 되돌아가는지(합치기) 확인
8. 사진 블록이 있는 도형 삭제 → Undo → 사진이 보인다 (500ms 이상 기다린 뒤)
9. 텍스트 입력칸에서 Ctrl+Z 가 도형을 되돌리지 않는다
10. 새로고침 후 연산 결과·Undo 결과가 IndexedDB 에서 그대로 로드된다
11. `npm run build` 통과, CLAUDE.md 의 저장 게이트 자체 점검이 여전히 TS2345

## 7. 하지 말 것 (2-A 범위 밖)

- 3개 이상 한 번에 합집합, 우클릭 메뉴 (D3·D4)
- 속성·블록·레이어 작업의 Undo (D1)
- 스냅(F-12), 구멍 추가 도구(F-13) — 03 프롬프트 완료 기준에 없다
- 편집 불가 도형의 꼭짓점 편집 지원
- 테이블 뷰·파일 업로드·배경지도·경로 (2-B ~ 2-E), IndexedDB 스키마 버전 올리기(2-C)
- MapLibre 소스 변경분 갱신 (03 의 "부채 정리" 항목 — 피처 수가 늘어나는 2-C 에서)
