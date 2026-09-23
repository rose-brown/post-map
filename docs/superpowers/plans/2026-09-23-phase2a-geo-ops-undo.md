# Phase 2-A 구현 계획 — 면적·길이, 공간 연산, Undo/Redo

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 정보 페이지에 면적·길이를 표시하고, 버퍼·합집합·교차·차집합을 미리보기 후 새 피처로 만들며, 지오메트리 변경을 Undo/Redo 한다.

**Architecture:** 계산은 `src/lib/geo/` 순수 함수, Undo 는 `src/store/history.ts` 의 순수 스택 + 스토어의 적용 함수.
Terra Draw 가 담지 못하는 도형(MultiPolygon·구멍 있는 Polygon)은 별도 MapLibre 소스 `shapes` 로 그린다.
연산 진행 상태는 스토어의 `pendingOp`(저장 안 함)가 들고, 정보 페이지의 `OperationPanel` 과 지도의 `preview` 소스가 그것을 그린다.

**Tech Stack:** Vite + React 19 + TS strict, zustand 5, Terra Draw 1.35, MapLibre 6, Turf 7.4 (개별 패키지 import — 기존 코드가 `@turf/circle`, `@turf/bbox` 로 그렇게 한다), Dexie 4.

**Spec:** `docs/superpowers/specs/2026-09-23-phase2a-geo-ops-undo-design.md` — 결정 D1~D6 과 3절(Terra Draw 제약)을 먼저 읽어라.

## Global Constraints

- 불변 규칙 1: 저장 함수는 `Persistable<T>` 만 받는다. 연산 결과·Undo 복원은 모두 `userInput()` 으로 감싼다 (사용자 도형에서 나온 값).
- 불변 규칙 3: 거리·면적은 측지 계산(Turf). 픽셀·위경도 차 금지.
- 불변 규칙 5: 지오메트리는 GeoJSON 그대로.
- 불변 규칙 7: 새 버튼은 `touch-target`(44px) 클래스 또는 `min-h-[44px]` 로 터치 타깃을 레이아웃에서 보장한다.
- Terra Draw 로 가는 좌표는 소수점 **9자리** 이하 (`lib/geo/ops.ts` 에서 절삭).
- zustand 셀렉터 안에서 배열·객체를 새로 만들지 않는다. 불리언·원시값·스토어의 기존 참조만 고른다.
- `map.isStyleLoaded()` 를 게이트로 쓰지 않는다. `mapReady` 만 쓴다.
- 새 삭제 경로도 동기화 이펙트(`syncedIds` 고아 제거)를 우회하지 않는다 — 스토어에서 지우면 지도는 이펙트가 맞춘다.
- 커밋 메시지 끝: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
- UI 문구는 한국어, 기존 톤(짧은 명사형)을 따른다.

## 테스트 방식

- **순수 함수**(`lib/geo`, `store/history.ts`)는 Node 24 내장 `node:test` 로 TDD 한다. 의존성 추가 없음.
  테스트는 `tests/*.test.ts` 에 두고 `npm test` (= `node --test tests/`) 로 돈다. Node 24 는 `.ts` 를 타입 제거로 직접 실행한다.
  - 그래서 **`lib/geo/*.ts`·`store/history.ts` 는 상대경로 런타임 import 를 하지 않는다** (`import type` 은 지워지므로 괜찮다).
    테스트 파일은 `../src/lib/geo/ops.ts` 처럼 확장자를 붙여 import 한다.
  - `tests/` 는 `tsconfig.app.json` 의 `include: ["src"]` 밖이라 빌드·타입체크에 안 들어간다.
- **UI·지도 동작**은 CLAUDE.md 대로 Playwright MCP 로 dev 서버(`npm run dev`, 5173)를 직접 몬다.
  사각형 도구는 **클릭 → 이동 → 클릭**이다. 정보 패널이 열리면 지도가 리사이즈되므로 좌표를 매번 다시 계산한다.
- 모든 태스크 끝에 `npm run typecheck` 통과.

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/lib/geo/rings.ts` | (이동) 동심원 지오메트리 |
| `src/lib/geo/measure.ts` | 측지 면적·길이와 표시 문자열 |
| `src/lib/geo/ops.ts` | 버퍼·불리언 연산, `OpResult`, 결과 설명 문자열 |
| `src/lib/geo/editable.ts` | Terra Draw 가 담을 수 있는 지오메트리인가 |
| `src/store/history.ts` | Undo/Redo 스택과 "무엇을 되돌릴지" 계산 (순수) |
| `src/store/useStore.ts` | 기록 지점, undo/redo 적용, `pendingOp` |
| `src/map/MapView.tsx` | 드래그 합치기, TD 지오메트리 역반영, `shapes`·`preview` 소스, 대상 선택, 단축키 |
| `src/ui/OperationPanel.tsx` | 정보 페이지의 `공간 연산` 섹션 (InfoPage 가 403줄이라 분리) |
| `src/ui/InfoPage.tsx` | 측정값·생성 방식·편집 불가 안내·OperationPanel 배치 |
| `src/ui/Toolbar.tsx` | 되돌리기·다시 하기 버튼 |
| `src/types.ts` | `DerivedOp`, `isRing`, `featureName` |
| `tests/geo.test.ts`, `tests/history.test.ts` | 순수 함수 테스트 |

---

### Task 1: `lib/geo` 측정 함수 + 테스트 기반 + rings 이동

**Files:**
- Create: `src/lib/geo/measure.ts`, `tests/geo.test.ts`
- Move: `src/map/rings.ts` → `src/lib/geo/rings.ts` (내용 그대로)
- Modify: `src/map/MapView.tsx:36`, `src/store/useStore.ts:28` (import 경로), `package.json` (scripts)

**Interfaces:**
- Produces: `area(g: Geometry): number` (㎡, 면이 아니면 0), `length(g: Geometry): number` (m, 선이 아니면 0),
  `formatArea(m2: number): string`, `formatLength(m: number): string`, `PYEONG_M2 = 3.3058`

- [ ] **Step 1: 테스트 스크립트 추가**

`package.json` 의 `scripts` 에 한 줄 추가:

```json
"test": "node --test tests/"
```

- [ ] **Step 2: 실패하는 테스트 작성** — `tests/geo.test.ts`

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { area, length, formatArea, formatLength } from '../src/lib/geo/measure.ts'

// 경도 0.01° × 위도 0.01° 사각형 (서울 부근). 측지 면적은 대략 0.88 × 1.11 km
const square = {
  type: 'Polygon' as const,
  coordinates: [[[127, 37.5], [127.01, 37.5], [127.01, 37.51], [127, 37.51], [127, 37.5]]],
}

test('area: polygon 은 측지 ㎡, 점·선은 0', () => {
  const m2 = area(square)
  assert.ok(m2 > 950_000 && m2 < 1_010_000, `got ${m2}`)
  assert.equal(area({ type: 'Point', coordinates: [127, 37.5] }), 0)
  assert.equal(area({ type: 'LineString', coordinates: [[127, 37.5], [127.01, 37.5]] }), 0)
})

test('area: 구멍은 면적에서 빠진다', () => {
  const holed = {
    type: 'Polygon' as const,
    coordinates: [
      square.coordinates[0],
      [[127.003, 37.503], [127.003, 37.506], [127.006, 37.506], [127.006, 37.503], [127.003, 37.503]],
    ],
  }
  assert.ok(area(holed) < area(square))
})

test('length: line 은 측지 m, 면은 0', () => {
  const m = length({ type: 'LineString', coordinates: [[127, 37.5], [127.01, 37.5]] })
  assert.ok(m > 870 && m < 890, `got ${m}`)
  assert.equal(length(square), 0)
})

test('formatArea: ㎡ · 평 · ㎢ 병기', () => {
  assert.equal(formatArea(1240), '1,240㎡ · 375평 · 0.0012㎢')
  assert.equal(formatArea(2_500_000), '2,500,000㎡ · 756,247평 · 2.5㎢')
})

test('formatLength: m · km 병기', () => {
  assert.equal(formatLength(850), '850m · 0.85km')
  assert.equal(formatLength(12_000), '12,000m · 12km')
})
```

- [ ] **Step 3: 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../src/lib/geo/measure.ts'`

- [ ] **Step 4: 구현** — `src/lib/geo/measure.ts`

```ts
import turfArea from '@turf/area'
import turfLength from '@turf/length'
import type { Geometry } from 'geojson'

/**
 * 불변 규칙 3 — 측지 계산. Turf 는 지구 반지름 기준으로 잰다.
 * 이 파일은 node:test 가 직접 실행하므로 상대경로 런타임 import 를 두지 않는다.
 */

/** 1평 = 3.3058㎡ (PRD F-25). */
export const PYEONG_M2 = 3.3058

export function area(g: Geometry): number {
  if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') return 0
  return turfArea(g)
}

export function length(g: Geometry): number {
  if (g.type !== 'LineString' && g.type !== 'MultiLineString') return 0
  return turfLength({ type: 'Feature', geometry: g, properties: {} }, { units: 'meters' })
}

const int = (n: number) => Math.round(n).toLocaleString('ko-KR')

export function formatArea(m2: number): string {
  const km2 = m2 / 1_000_000
  // 1㎢ 미만은 유효숫자 2자리(0.0012), 이상은 소수 둘째 자리(2.5)
  const km2Text = km2 < 1 ? Number(km2.toPrecision(2)) : Number(km2.toFixed(2))
  return `${int(m2)}㎡ · ${int(m2 / PYEONG_M2)}평 · ${km2Text}㎢`
}

export function formatLength(m: number): string {
  return `${int(m)}m · ${Number((m / 1000).toFixed(2))}km`
}
```

- [ ] **Step 5: 통과 확인**

Run: `npm test`
Expected: PASS 5/5. (`2,500,000/3.3058 = 756,246.6` → `756,247`. 다르면 계산을 다시 보고 기대값이 아니라 원인을 고친다.)

- [ ] **Step 6: rings 이동**

```bash
mkdir -p src/lib/geo && git mv src/map/rings.ts src/lib/geo/rings.ts
```

`src/map/MapView.tsx:36` → `import { ringLabelPoints } from '../lib/geo/rings'`
`src/store/useStore.ts:28` → `import { buildRings } from '../lib/geo/rings'`

- [ ] **Step 7: 확인 후 커밋**

Run: `npm run typecheck && npm test` — 둘 다 통과.

```bash
git add package.json tests/geo.test.ts src/lib/geo src/map/MapView.tsx src/store/useStore.ts
git commit -m "feat: lib/geo 측지 면적·길이와 node:test 기반

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `lib/geo` 공간 연산 + 편집 가능 판정

**Files:**
- Create: `src/lib/geo/ops.ts`, `src/lib/geo/editable.ts`
- Test: `tests/geo.test.ts` (추가)

**Interfaces:**
- Produces:
  ```ts
  export type Area = Polygon | MultiPolygon
  export type OpKind = 'buffer' | 'union' | 'intersect' | 'difference'
  export type OpResult = { ok: true; geometry: Area } | { ok: false; reason: string }
  export function isArea(g: Geometry): g is Area
  export function buffer(g: Geometry, meters: number): OpResult
  export function union(a: Geometry, b: Geometry): OpResult
  export function intersect(a: Geometry, b: Geometry): OpResult
  export function difference(a: Geometry, b: Geometry): OpResult
  export function runOp(op: OpKind, a: Geometry, b?: Geometry, distance?: number): OpResult | undefined
  export function describeOp(op: OpKind, names: string[], distance?: number): string
  export function isEditable(g: Geometry): boolean   // editable.ts
  ```
  `runOp` 은 입력이 아직 다 모이지 않았으면(`buffer` 인데 distance 없음, 이항인데 b 없음) `undefined`.

- [ ] **Step 1: 실패하는 테스트 추가** — `tests/geo.test.ts` 끝에

```ts
import { buffer, union, intersect, difference, runOp, describeOp, isArea } from '../src/lib/geo/ops.ts'
import { isEditable } from '../src/lib/geo/editable.ts'

const rect = (x0: number, y0: number, x1: number, y1: number) => ({
  type: 'Polygon' as const,
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
})
const A = rect(127, 37.5, 127.01, 37.51)
const FAR = rect(127.02, 37.5, 127.03, 37.51)
const INNER = rect(127.003, 37.503, 127.006, 37.506)
const line = { type: 'LineString' as const, coordinates: [[127, 37.5], [127.01, 37.5]] }

const maxDecimals = (g: unknown): number =>
  Math.max(...JSON.stringify(g).match(/-?\d+\.\d+/g)!.map((s) => s.split('.')[1].length))

test('buffer: 양수는 커지고, 음수는 줄고, 너무 큰 음수는 비었다고 알린다', () => {
  const grown = buffer(A, 100)
  assert.ok(grown.ok && area(grown.geometry) > area(A))
  const shrunk = buffer(A, -100)
  assert.ok(shrunk.ok && area(shrunk.geometry) < area(A))
  assert.deepEqual(buffer(A, -10_000), { ok: false, reason: '버퍼 결과가 비어 있습니다' })
})

test('buffer: line 은 polygon 이 되고, point 와 0m 는 거부', () => {
  const r = buffer(line, 50)
  assert.ok(r.ok && r.geometry.type === 'Polygon')
  assert.equal(buffer({ type: 'Point', coordinates: [127, 37.5] }, 50).ok, false)
  assert.equal(buffer(A, 0).ok, false)
})

test('union: 떨어진 두 면은 MultiPolygon', () => {
  const r = union(A, FAR)
  assert.ok(r.ok && r.geometry.type === 'MultiPolygon')
})

test('intersect: 안 겹치면 안내', () => {
  assert.deepEqual(intersect(A, FAR), { ok: false, reason: '겹치는 영역이 없습니다' })
  assert.ok(intersect(A, INNER).ok)
})

test('difference: 안쪽을 빼면 구멍, 완전히 덮이면 안내', () => {
  const r = difference(A, INNER)
  assert.ok(r.ok && r.geometry.type === 'Polygon' && r.geometry.coordinates.length === 2)
  assert.deepEqual(difference(INNER, A), { ok: false, reason: '남는 영역이 없습니다' })
})

test('불리언 연산은 면끼리만', () => {
  assert.equal(union(A, line).ok, false)
})

test('모든 결과는 소수점 9자리 이하 (Terra Draw 제약)', () => {
  const r = buffer(A, 123)
  assert.ok(r.ok && maxDecimals(r.geometry) <= 9)
})

test('runOp: 입력이 덜 모이면 undefined', () => {
  assert.equal(runOp('buffer', A), undefined)
  assert.equal(runOp('union', A), undefined)
  assert.ok(runOp('buffer', A, undefined, 10)?.ok)
  assert.ok(runOp('union', A, FAR)?.ok)
})

test('describeOp: 생성 방식 문자열', () => {
  assert.equal(describeOp('buffer', ['공원'], 300), 'buffer(공원, 300m)')
  assert.equal(describeOp('difference', ['공원', '놀이터']), 'difference(공원, 놀이터)')
})

test('isArea / isEditable', () => {
  assert.ok(isArea(A) && !isArea(line))
  assert.ok(isEditable(A) && isEditable(line) && isEditable({ type: 'Point', coordinates: [0, 0] }))
  const holed = difference(A, INNER)
  assert.ok(holed.ok && !isEditable(holed.geometry))
  const multi = union(A, FAR)
  assert.ok(multi.ok && !isEditable(multi.geometry))
})
```

- [ ] **Step 2: 실패 확인**

Run: `npm test` — Expected: FAIL, `Cannot find module .../ops.ts`

- [ ] **Step 3: 구현** — `src/lib/geo/ops.ts`

```ts
import turfBuffer from '@turf/buffer'
import turfUnion from '@turf/union'
import turfIntersect from '@turf/intersect'
import turfDifference from '@turf/difference'
import truncate from '@turf/truncate'
import { feature, featureCollection } from '@turf/helpers'
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from 'geojson'

/**
 * 공간 연산 (PRD F-21~F-24). 결과는 항상 새 지오메트리이고 입력을 건드리지 않는다.
 * 이 파일은 node:test 가 직접 실행하므로 상대경로 런타임 import 를 두지 않는다.
 */

export type Area = Polygon | MultiPolygon
export type OpKind = 'buffer' | 'union' | 'intersect' | 'difference'
export type OpResult = { ok: true; geometry: Area } | { ok: false; reason: string }

/** Terra Draw 는 소수점 9자리를 넘는 좌표를 조용히 거부한다 (CLAUDE.md "이미 물린 함정"). */
const PRECISION = 9

export const isArea = (g: Geometry): g is Area => g.type === 'Polygon' || g.type === 'MultiPolygon'

const isEmpty = (g: Area) => g.coordinates.length === 0

const done = (g: Area): OpResult => ({
  ok: true,
  geometry: truncate(g, { precision: PRECISION, coordinates: 2 }),
})

export function buffer(g: Geometry, meters: number): OpResult {
  if (g.type !== 'LineString' && !isArea(g)) {
    return { ok: false, reason: '선이나 면에만 버퍼를 걸 수 있습니다' }
  }
  if (!Number.isFinite(meters) || meters === 0) {
    return { ok: false, reason: '0 이 아닌 거리를 입력하세요' }
  }
  // 음수 버퍼가 도형을 다 먹어버리면 Turf 는 undefined 를 준다. 선의 음수 버퍼도 마찬가지다.
  const out = turfBuffer(feature(g), meters, { units: 'meters' })
  const geom = out?.geometry
  if (!geom || !isArea(geom) || isEmpty(geom)) {
    return { ok: false, reason: '버퍼 결과가 비어 있습니다' }
  }
  return done(geom)
}

type Boolean2 = (fc: FeatureCollection<Area>) => Feature<Area> | null

function binary(op: Boolean2, a: Geometry, b: Geometry, empty: string): OpResult {
  if (!isArea(a) || !isArea(b)) return { ok: false, reason: '면(polygon)끼리만 연산할 수 있습니다' }
  const out = op(featureCollection([feature(a), feature(b)]))
  if (!out || isEmpty(out.geometry)) return { ok: false, reason: empty }
  return done(out.geometry)
}

export const union = (a: Geometry, b: Geometry) => binary(turfUnion, a, b, '합칠 수 없습니다')
export const intersect = (a: Geometry, b: Geometry) =>
  binary(turfIntersect, a, b, '겹치는 영역이 없습니다')
/** a − b. 순서가 의미를 가진다. */
export const difference = (a: Geometry, b: Geometry) =>
  binary(turfDifference, a, b, '남는 영역이 없습니다')

export function runOp(
  op: OpKind,
  a: Geometry,
  b?: Geometry,
  distance?: number,
): OpResult | undefined {
  if (op === 'buffer') return distance === undefined ? undefined : buffer(a, distance)
  if (!b) return undefined
  return { union, intersect, difference }[op](a, b)
}

/** 정보 페이지의 `생성 방식` 과 결과 도형의 제목. 예: `buffer(공원, 300m)` */
export function describeOp(op: OpKind, names: string[], distance?: number): string {
  const args = op === 'buffer' ? [names[0], `${distance}m`] : names
  return `${op}(${args.join(', ')})`
}
```

`src/lib/geo/editable.ts`:

```ts
import type { Geometry } from 'geojson'

/**
 * Terra Draw 가 담을 수 있는 지오메트리인가.
 * terra-draw 1.35 의 polygon 검증은 구멍이 있으면 `Feature has holes`,
 * Polygon 이 아니면 `Feature is not a Polygon` 으로 거부한다 (dist 소스에서 확인).
 * 여기서 false 인 도형은 MapView 의 `shapes` 소스로 그리고 꼭짓점 편집을 주지 않는다.
 */
export function isEditable(g: Geometry): boolean {
  if (g.type === 'Point' || g.type === 'LineString') return true
  return g.type === 'Polygon' && g.coordinates.length === 1
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test` — Expected: 전부 PASS. `npm run typecheck` — PASS.
(타입 에러가 `truncate` 반환형에서 나면 `truncate<Area>(g, ...)` 로 제네릭을 명시한다.)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/geo/ops.ts src/lib/geo/editable.ts tests/geo.test.ts
git commit -m "feat: 버퍼·합집합·교차·차집합 순수 함수

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 타입 확장 + 링 판정 정리 + 정보 페이지 측정 표시

연산 결과는 `derivedFrom` 을 갖지만 **일반 도형**이다(D2). 지금 코드 곳곳의 `!f.derivedFrom` 은 "링이 아니다"라는 뜻으로 쓰였으므로
`!isRing(f)` 로 바꿔야 결과 도형이 목록·지도·개수에서 사라지지 않는다.

**Files:**
- Modify: `src/types.ts:85-89` (derivedFrom), 파일 끝에 헬퍼
- Modify: `src/ui/FeatureList.tsx:72`, `src/ui/LayerPanel.tsx:31`, `src/map/MapView.tsx:353`
- Modify: `src/ui/InfoPage.tsx` (측정·생성 방식)

**Interfaces:**
- Produces: `type DerivedOp = 'ring' | OpKind 와 같은 문자열 유니온`, `isRing(f: Feature): boolean`,
  `featureName(features: Feature[], id: string): string` — 제목, 없으면 id 앞 8자, 없는 도형이면 `(삭제됨)`

- [ ] **Step 1: `src/types.ts` 수정**

`derivedFrom` 을 다음으로 교체:

```ts
  /** 링은 중심과 연동되는 파생 도형, 나머지는 한 번 만들어진 뒤 독립된 일반 도형이다 (출처 기록용). */
  derivedFrom?: {
    op: DerivedOp
    /** difference 는 [A, B] 순서가 의미를 가진다 (A − B). */
    sourceIds: string[]
    /** buffer: { distance: number } */
    params: Record<string, unknown>
  }
```

`Feature` 인터페이스 위에:

```ts
export type DerivedOp = 'ring' | 'buffer' | 'union' | 'intersect' | 'difference'
```

파일 끝에:

```ts
/** 동심원 링인가. 링만 Terra Draw·목록·개수에서 빠진다. 공간 연산 결과는 일반 도형이다. */
export const isRing = (f: Feature): boolean => f.derivedFrom?.op === 'ring'

/** 화면에 쓰는 도형 이름. 생성 방식 문자열(`buffer(공원, 300m)`)에 들어간다. */
export function featureName(features: Feature[], id: string): string {
  const f = features.find((x) => x.id === id)
  if (!f) return '(삭제됨)'
  return f.title.trim() || f.id.slice(0, 8)
}
```

- [ ] **Step 2: `!f.derivedFrom` → `!isRing(f)` 세 곳**

- `src/ui/FeatureList.tsx:72`: `features.filter((f) => !isRing(f) && visible.has(f.layerId))` — `import { isRing, type Feature, type Layer } from '../types'`
- `src/ui/LayerPanel.tsx:31`: `features.filter((f) => f.layerId === layerId && !isRing(f)).length` — `isRing` import 추가
- `src/map/MapView.tsx:353`: `const drawable = features.filter((f) => !isRing(f))` — `import { uid, isRing } from '../types'`

`MapView.tsx:482` 의 point-icons 필터(`!f.derivedFrom`)는 건드리지 않는다 (point 결과는 생기지 않는다).

- [ ] **Step 3: `src/ui/InfoPage.tsx` 측정·생성 방식**

import 추가:

```ts
import { area, length, formatArea, formatLength } from '../lib/geo/measure'
import { describeOp, type OpKind } from '../lib/geo/ops'
```

`../types` import 에 `featureName` 추가.

훅은 early return(51행) 앞에 있어야 한다. 45행 `applyTemplate` 아래에:

```ts
  const features = useStore((s) => s.features)
```

53행 `const coords = ...` 아래에 (렌더마다 계산 — 지오메트리에서 언제든 다시 나오는 값이라 저장하지 않는다):

```ts
  const m2 = area(feature.geometry)
  const meters = length(feature.geometry)
  const origin =
    feature.derivedFrom && feature.derivedFrom.op !== 'ring'
      ? describeOp(
          feature.derivedFrom.op as OpKind,
          feature.derivedFrom.sourceIds.map((id) => featureName(features, id)),
          Number(feature.derivedFrom.params.distance),
        )
      : null
```

160~164행의 좌표 `<div className="font-mono">…</div>` 바로 아래에:

```tsx
          {m2 > 0 && <div data-testid="measure-area">면적 {formatArea(m2)}</div>}
          {meters > 0 && <div data-testid="measure-length">길이 {formatLength(meters)}</div>}
          {origin && <div data-testid="derived-origin">생성 방식: {origin}</div>}
```

- [ ] **Step 4: 타입체크**

Run: `npm run typecheck` — PASS

- [ ] **Step 5: 브라우저 확인 (Playwright MCP)**

1. `npm run dev` (백그라운드) → `http://localhost:5173` 이동
2. 사각형 도구: 지도에서 클릭 → 이동 → 클릭으로 사각형 하나
3. 정보 페이지의 `measure-area` 가 `…㎡ · …평 · …㎢` 형식인지 스냅샷으로 확인
4. 선 도구로 두 점 찍고 Enter → `measure-length` 가 `…m · …km`
5. 사각형 꼭짓점을 끌고 다시 선택 → 면적 숫자가 바뀐다
6. 스크린샷 `docs/screenshots/phase2a-measure.png`

- [ ] **Step 6: 커밋**

```bash
git add src/types.ts src/ui/FeatureList.tsx src/ui/LayerPanel.tsx src/map/MapView.tsx src/ui/InfoPage.tsx docs/screenshots/phase2a-measure.png
git commit -m "feat: 정보 페이지에 측지 면적·길이와 생성 방식 표시

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Undo 스택 (순수)

**Files:**
- Create: `src/store/history.ts`, `tests/history.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Change =
    | { kind: 'create'; features: Feature[] }
    | { kind: 'delete'; features: Feature[]; blobs: StoredBlob[] }
    | { kind: 'geometry'; id: string; before: Geometry; after: Geometry }
  export interface Entry { label: string; changes: Change[] }
  export interface History { past: Entry[]; future: Entry[] }
  export interface Effect {
    upsert: Feature[]; remove: string[]; restoreBlobs: StoredBlob[]
    geometry: Array<{ id: string; geometry: Geometry }>
  }
  export const HISTORY_LIMIT = 50
  export const emptyHistory: () => History
  export function record(h: History, entry: Entry): History
  export function stepBack(h: History): { history: History; effect: Effect } | null
  export function stepForward(h: History): { history: History; effect: Effect } | null
  ```

- [ ] **Step 1: 실패하는 테스트** — `tests/history.test.ts`

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  HISTORY_LIMIT, emptyHistory, record, stepBack, stepForward, type Entry,
} from '../src/store/history.ts'

const f = (id: string) => ({
  id, layerId: 'lyr', geometry: { type: 'Point' as const, coordinates: [0, 0] },
  title: '', properties: {}, blocks: [], parentId: null, createdAt: '', updatedAt: '',
})
const P1 = { type: 'Point' as const, coordinates: [1, 1] }
const P2 = { type: 'Point' as const, coordinates: [2, 2] }

test('create 를 되돌리면 지우고, 다시 하면 되살린다', () => {
  const h = record(emptyHistory(), { label: '작도', changes: [{ kind: 'create', features: [f('a')] }] })
  const back = stepBack(h)!
  assert.deepEqual(back.effect.remove, ['a'])
  assert.deepEqual(back.effect.upsert, [])
  const fwd = stepForward(back.history)!
  assert.deepEqual(fwd.effect.upsert.map((x) => x.id), ['a'])
  assert.equal(fwd.history.past.length, 1)
})

test('delete 를 되돌리면 도형과 Blob 을 복원한다', () => {
  const blob = { id: 'b1', featureId: 'a', blob: new Blob(['x']) }
  const h = record(emptyHistory(), {
    label: '삭제', changes: [{ kind: 'delete', features: [f('a')], blobs: [blob] }],
  })
  const back = stepBack(h)!
  assert.deepEqual(back.effect.upsert.map((x) => x.id), ['a'])
  assert.deepEqual(back.effect.restoreBlobs, [blob])
  const fwd = stepForward(back.history)!
  assert.deepEqual(fwd.effect.remove, ['a'])
  assert.deepEqual(fwd.effect.restoreBlobs, [])
})

test('geometry 는 before/after 로 오간다', () => {
  const h = record(emptyHistory(), {
    label: '편집', changes: [{ kind: 'geometry', id: 'a', before: P1, after: P2 }],
  })
  assert.deepEqual(stepBack(h)!.effect.geometry, [{ id: 'a', geometry: P1 }])
  assert.deepEqual(stepForward(stepBack(h)!.history)!.effect.geometry, [{ id: 'a', geometry: P2 }])
})

test('새 기록은 redo 를 비운다', () => {
  const e: Entry = { label: '작도', changes: [{ kind: 'create', features: [f('a')] }] }
  const back = stepBack(record(emptyHistory(), e))!
  const h = record(back.history, { label: '작도', changes: [{ kind: 'create', features: [f('b')] }] })
  assert.equal(h.future.length, 0)
  assert.equal(stepForward(h), null)
})

test('상한 50 — 넘치면 오래된 것부터 버린다', () => {
  let h = emptyHistory()
  for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
    h = record(h, { label: String(i), changes: [{ kind: 'create', features: [f(`f${i}`)] }] })
  }
  assert.equal(h.past.length, HISTORY_LIMIT)
  assert.equal(h.past[0].label, '5')
})

test('빈 기록은 쌓지 않고, 빈 스택에서 되돌리면 null', () => {
  const h = record(emptyHistory(), { label: 'x', changes: [] })
  assert.equal(h.past.length, 0)
  assert.equal(stepBack(h), null)
})
```

- [ ] **Step 2: 실패 확인** — `npm test` → FAIL (`history.ts` 없음)

- [ ] **Step 3: 구현** — `src/store/history.ts`

```ts
import type { Geometry } from 'geojson'
import type { Feature, StoredBlob } from '../types'

/**
 * Undo/Redo (PRD F-11). 대상은 지오메트리뿐이다 — 속성·블록 텍스트는 입력칸 기본 Ctrl+Z 에 맡긴다.
 *
 * 스냅샷이 아니라 변경 기록이다. features 전체를 스냅샷으로 되돌리면 그 사이 다른 도형에 입력한
 * 속성까지 되돌아간다. 이 파일은 순수하다 — 스토어·IndexedDB 적용은 useStore 가 한다.
 * node:test 가 직접 실행하므로 런타임 상대경로 import 를 두지 않는다 (import type 은 지워진다).
 */

export type Change =
  | { kind: 'create'; features: Feature[] }
  /** blobs 는 기록 뒤에 비동기로 채워진다 (useStore.removeFeature). */
  | { kind: 'delete'; features: Feature[]; blobs: StoredBlob[] }
  | { kind: 'geometry'; id: string; before: Geometry; after: Geometry }

export interface Entry {
  label: string
  changes: Change[]
}

export interface History {
  past: Entry[]
  future: Entry[]
}

/** 스토어가 적용할 일. 되돌리기·다시 하기 모두 이 모양으로 나온다. */
export interface Effect {
  upsert: Feature[]
  remove: string[]
  restoreBlobs: StoredBlob[]
  geometry: Array<{ id: string; geometry: Geometry }>
}

export const HISTORY_LIMIT = 50

export const emptyHistory = (): History => ({ past: [], future: [] })

export function record(h: History, entry: Entry): History {
  if (!entry.changes.length) return h
  return { past: [...h.past, entry].slice(-HISTORY_LIMIT), future: [] }
}

function effectOf(entry: Entry, forward: boolean): Effect {
  const effect: Effect = { upsert: [], remove: [], restoreBlobs: [], geometry: [] }
  const changes = forward ? entry.changes : [...entry.changes].reverse()
  for (const c of changes) {
    if (c.kind === 'geometry') {
      effect.geometry.push({ id: c.id, geometry: forward ? c.after : c.before })
    } else if ((c.kind === 'create') === forward) {
      // create 를 다시 하거나, delete 를 되돌린다
      effect.upsert.push(...c.features)
      if (c.kind === 'delete') effect.restoreBlobs.push(...c.blobs)
    } else {
      effect.remove.push(...c.features.map((f) => f.id))
    }
  }
  return effect
}

export function stepBack(h: History): { history: History; effect: Effect } | null {
  const entry = h.past.at(-1)
  if (!entry) return null
  return {
    history: { past: h.past.slice(0, -1), future: [...h.future, entry] },
    effect: effectOf(entry, false),
  }
}

export function stepForward(h: History): { history: History; effect: Effect } | null {
  const entry = h.future.at(-1)
  if (!entry) return null
  return {
    history: { past: [...h.past, entry], future: h.future.slice(0, -1) },
    effect: effectOf(entry, true),
  }
}
```

- [ ] **Step 4: 통과 확인** — `npm test` 전부 PASS, `npm run typecheck` PASS

- [ ] **Step 5: 커밋**

```bash
git add src/store/history.ts tests/history.test.ts
git commit -m "feat: 지오메트리 Undo/Redo 스택

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 스토어에 Undo 연결 — 생성·삭제·동심원 + 툴바 버튼

**Files:**
- Modify: `src/store/useStore.ts`
- Modify: `src/ui/Toolbar.tsx`

**Interfaces:**
- Consumes: Task 4 의 `History`, `Entry`, `record`, `stepBack`, `stepForward`, `emptyHistory`, `Effect`
- Produces (State 에 추가):
  ```ts
  history: History
  undo(): void
  redo(): void
  recordGeometry(id: string, before: Geometry, after: Geometry): void
  setRings(centerId: string, radii: number[], record?: boolean): void   // 기존 시그니처에 record 추가, 기본 true
  ```

동심원 링 id 를 **결정적으로** 만든다: `rng_${centerId}_${radius}`. 중심을 끌 때마다 링이 기록 없이 다시 만들어지는데,
id 가 매번 새로 나오면 앞선 `setRings` 기록이 가리키는 링과 실제 링이 어긋나 Undo 후 고아 링이 남는다.

- [ ] **Step 1: import·상태 추가** (`src/store/useStore.ts`)

```ts
import type { Geometry, Point } from 'geojson'
import { type StoredBlob } from '../types'   // 기존 types import 목록에 StoredBlob 을 합친다
import { getBlob, putBlob } from '../db/repo' // 기존 repo import 목록에 합친다
import { emptyHistory, record, stepBack, stepForward, type Effect, type Entry, type History } from './history'
```

`interface State` 에:

```ts
  /** 지오메트리 Undo/Redo. 메모리에만 있다 — 새로고침하면 사라진다. */
  history: History
  undo(): void
  redo(): void
  /** Terra Draw 드래그 한 번이 끝났을 때 MapView 가 부른다 (드래그 중 이벤트는 합친다). */
  recordGeometry(id: string, before: Geometry, after: Geometry): void
```

`setRings` 선언을 `setRings(centerId: string, radii: number[], record?: boolean): void` 로.

초기값에 `history: emptyHistory(),`.

모듈 수준(`initPromise` 아래)에 헬퍼:

```ts
/** 지우기 전에 블록이 참조하는 Blob 을 읽어 둔다. repo.flush() 가 피처와 함께 blobs 를 지우기 때문이다.
 *  이 읽기는 500ms 뒤 flush 의 쓰기 트랜잭션보다 먼저 열리므로 지워지기 전 값을 읽는다. */
function captureBlobs(features: Feature[], into: StoredBlob[]): void {
  features.forEach((f) =>
    f.blocks.forEach((b) =>
      b.refs?.forEach((ref) => {
        void getBlob(ref.id).then((blob) => {
          if (blob) into.push({ id: ref.id, featureId: f.id, blob })
        })
      }),
    ),
  )
}

const ringId = (centerId: string, radius: number) => `rng_${centerId}_${radius}`
```

- [ ] **Step 2: 기록 지점**

`addFeatureFromGeometry` 의 `set({ features: [...features, feature] })` →

```ts
    set({
      features: [...features, feature],
      history: record(get().history, { label: '추가', changes: [{ kind: 'create', features: [feature] }] }),
    })
```

`addFeatureFromGeometryWithId` 도 같은 방식으로 `label: '작도'`.

`removeFeature` 전체 교체:

```ts
  removeFeature(id) {
    const { features } = get()
    // 동심원 링은 중심 point 를 참조한다. 부모를 지우면 같이 지운다 (cascade).
    const removed = features.filter((f) => f.id === id || f.parentId === id)
    const ids = removed.map((f) => f.id)
    const blobs: StoredBlob[] = []
    captureBlobs(removed, blobs)
    deleteFeatures(ids)
    set({
      features: features.filter((f) => !ids.includes(f.id)),
      selectedId: null,
      history: record(get().history, {
        label: '삭제',
        changes: [{ kind: 'delete', features: removed, blobs }],
      }),
    })
  },
```

`removeLayer` 의 `set({...})` 에 `history: emptyHistory(),` 추가 — 주석 `// 레이어 작업은 Undo 대상이 아니다. 남겨 두면 없는 레이어를 가리킨다.`

`setRings` 전체 교체:

```ts
  setRings(centerId, radii, shouldRecord = true) {
    const { features } = get()
    const center = features.find((f) => f.id === centerId)
    if (!center || center.geometry.type !== 'Point') return

    const old = features.filter((f) => f.parentId === centerId && f.derivedFrom?.op === 'ring')
    const unique = [...new Set(radii)]
    const same =
      old.length === unique.length &&
      old.every((o) => unique.includes(Number(o.properties.radius)))
    // 반경이 그대로면(입력칸 blur 등) 기록을 남기지 않는다. 중심 이동은 same 이어도 다시 그려야 한다.
    if (same && shouldRecord) return
    if (old.length) deleteFeatures(old.map((f) => f.id))

    const coords = (center.geometry as Point).coordinates as [number, number]
    const created = buildRings(coords, unique).map<Feature>((ring) => ({
      // 결정적 id — 중심을 끌 때 기록 없이 다시 만들어도 앞선 기록의 링과 같은 id 가 된다.
      id: ringId(centerId, ring.radius),
      layerId: center.layerId,
      geometry: ring.geometry,
      title: ring.label,
      properties: { radius: ring.radius, label: ring.label },
      blocks: [],
      derivedFrom: { op: 'ring', sourceIds: [centerId], params: { radius: ring.radius } },
      parentId: centerId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }))

    // 반경은 사용자가 입력한 값, 중심은 사용자가 찍은 점이므로 사용자 소유 데이터다.
    saveFeatures(created.map((f) => userInput(f)))
    const entry: Entry = {
      label: '동심원',
      changes: [
        ...(old.length ? [{ kind: 'delete' as const, features: old, blobs: [] }] : []),
        ...(created.length ? [{ kind: 'create' as const, features: created }] : []),
      ],
    }
    set({
      features: [...features.filter((f) => !old.some((o) => o.id === f.id)), ...created],
      ...(shouldRecord ? { history: record(get().history, entry) } : {}),
    })
  },
```

주의: `deleteFeatures(old)` 뒤 `saveFeatures(created)` 순서여야 한다. 같은 id 가 둘 다에 있으면 `saveFeature` 가 `deletedFeatures` 에서 빼 준다(`repo.ts:113-124`).

- [ ] **Step 3: undo/redo/recordGeometry 액션**

`State` 구현부 끝(`setAddressHint` 위)에:

```ts
  recordGeometry(id, before, after) {
    if (JSON.stringify(before) === JSON.stringify(after)) return
    set({
      history: record(get().history, { label: '편집', changes: [{ kind: 'geometry', id, before, after }] }),
    })
  },

  undo() {
    const step = stepBack(get().history)
    if (!step) return
    set({ history: step.history })
    applyEffect(step.effect)
  },

  redo() {
    const step = stepForward(get().history)
    if (!step) return
    set({ history: step.history })
    applyEffect(step.effect)
  },
```

`create<State>(...)` 호출 **아래**(모듈 수준)에 적용 함수 — `useStore.getState()` 로 접근한다:

```ts
/** history 의 Effect 를 스토어와 IndexedDB 에 적용한다. 지도는 MapView 동기화 이펙트가 맞춘다. */
function applyEffect(effect: Effect): void {
  const state = useStore.getState()
  const layerIds = new Set(state.layers.map((l) => l.id))
  // 기록 속 도형의 레이어가 이미 없으면 건너뛴다 (레이어 삭제 시 스택을 비우지만 방어한다).
  const upsert = effect.upsert.filter((f) => layerIds.has(f.layerId))
  const removeSet = new Set(effect.remove)
  const geometryOf = new Map(effect.geometry.map((g) => [g.id, g.geometry]))

  effect.restoreBlobs.forEach((b) => void putBlob(b))

  let next = state.features
    .filter((f) => !removeSet.has(f.id))
    .map((f) => {
      const g = geometryOf.get(f.id)
      return g ? { ...f, geometry: g, updatedAt: nowIso() } : f
    })
  const present = new Set(next.map((f) => f.id))
  next = [...next, ...upsert.filter((f) => !present.has(f.id))]

  if (effect.remove.length) deleteFeatures(effect.remove)
  const touched = next.filter((f) => geometryOf.has(f.id) || upsert.some((u) => u.id === f.id))
  // 되돌리는 값도 원래 사용자가 만든 도형이다.
  if (touched.length) saveFeatures(touched.map((f) => userInput(f)))

  useStore.setState({
    features: next,
    selectedId: state.selectedId && removeSet.has(state.selectedId) ? null : state.selectedId,
  })

  // 중심 point 가 되돌아가면 링을 반경 그대로 다시 그린다 (드래그 중 링 갱신은 기록하지 않았다).
  geometryOf.forEach((_, id) => {
    const radii = useStore.getState().ringRadii(id)
    if (radii.length) useStore.getState().setRings(id, radii, false)
  })
}
```

- [ ] **Step 4: 툴바 버튼** (`src/ui/Toolbar.tsx`)

컴포넌트 안 훅 추가 (불리언 셀렉터 — 새 참조를 만들지 않는다):

```ts
  const canUndo = useStore((s) => s.history.past.length > 0)
  const canRedo = useStore((s) => s.history.future.length > 0)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
```

`TOOLS.map(...)` 닫는 `))}` 뒤, 바깥 `</div>` 앞에:

```tsx
      {[
        { key: 'undo', label: '되돌리기', icon: '↶', run: undo, enabled: canUndo, hint: 'Ctrl+Z' },
        { key: 'redo', label: '다시 하기', icon: '↷', run: redo, enabled: canRedo, hint: 'Ctrl+Shift+Z' },
      ].map((b) => (
        <button
          key={b.key}
          onClick={b.run}
          disabled={!b.enabled}
          title={`${b.label} (${b.hint})`}
          data-testid={b.key}
          className={`flex shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-[12px] font-medium text-ink-mut hover:bg-surface-sub disabled:opacity-35 ${
            horizontal ? 'min-h-[44px] min-w-[44px] py-2' : 'py-2'
          }`}
        >
          <span aria-hidden>{b.icon}</span>
          <span className={horizontal ? '' : 'hidden'}>{b.label}</span>
        </button>
      ))}
```

- [ ] **Step 5: 타입체크·테스트** — `npm run typecheck && npm test` PASS

- [ ] **Step 6: 브라우저 확인 (Playwright MCP)**

1. 점 하나 작도 → `undo` 버튼 활성 → 누르면 점이 지도·목록에서 사라짐 → `redo` 로 다시 나타남
2. 점 선택 → `기본 반경 그리기` → 되돌리기 → 링 사라짐 → 다시 하기 → 링 3개
3. 사각형 작도 → 정보 페이지에서 갤러리 블록 추가 후 사진 1장 업로드 → `삭제` → **1초 기다린 뒤** 되돌리기 → 도형 선택 → 사진이 보인다
4. 새로고침 → 3의 도형·사진이 남아 있다 (IndexedDB 반영)
5. 스크린샷 `docs/screenshots/phase2a-undo-delete.png`

- [ ] **Step 7: 커밋**

```bash
git add src/store/useStore.ts src/ui/Toolbar.tsx docs/screenshots/phase2a-undo-delete.png
git commit -m "feat: 작도·삭제·동심원 Undo/Redo 와 툴바 버튼

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: 편집 Undo — 드래그 합치기, 지도 역반영, 단축키

**Files:**
- Modify: `src/map/MapView.tsx` (`setupDraw` 의 finish/change/keydown, 동기화 이펙트)

**Interfaces:**
- Consumes: `useStore.getState().recordGeometry(id, before, after)`, `undo()`, `redo()`, `setRings(id, radii, false)`

- [ ] **Step 1: 편집 기준선 ref**

`syncedIds` 아래에:

```ts
  /** 드래그 한 번 = Undo 한 번. 첫 change 에서 편집 전 지오메트리를 잡아 두고 finish 에서 기록한다.
   *  비어 있지 않으면 드래그 중이다 — 동기화 이펙트가 이 동안 TD 로 지오메트리를 되밀지 않는다. */
  const editBaseline = useRef<Map<string, Geometry>>(new Map())
```

`import type { FeatureCollection, Geometry } from 'geojson'` 로 바꾼다.

- [ ] **Step 2: finish 핸들러 앞부분에 편집 완료 분기**

`draw.on('finish', (id) => {` → `draw.on('finish', (id, context) => {` 로 바꾸고 첫 줄에:

```ts
      // select 모드 편집(꼭짓점·이동·중점 삽입·꼭짓점 삭제)이 끝났다. 작도 완료는 action === 'draw'.
      if (context.action !== 'draw') {
        const key = String(id)
        const before = editBaseline.current.get(key)
        editBaseline.current.delete(key)
        const after = useStore.getState().features.find((f) => f.id === key)?.geometry
        if (before && after) useStore.getState().recordGeometry(key, before, after)
        return
      }
```

- [ ] **Step 3: change 핸들러 교체**

```ts
    draw.on('change', (ids, type, context) => {
      if (type !== 'update') return
      // api 발 change 는 Undo 가 지오메트리를 되민 결과다. 기준선을 오염시키지 않는다.
      if (context && 'origin' in context && context.origin === 'api') return
      const state = useStore.getState()
      ids.forEach((id) => {
        const key = String(id)
        const snapshot = draw.getSnapshotFeature(id)
        if (!snapshot) return
        const existing = state.features.find((f) => f.id === key)
        if (!existing) return
        if (JSON.stringify(existing.geometry) === JSON.stringify(snapshot.geometry)) return
        if (!editBaseline.current.has(key)) editBaseline.current.set(key, existing.geometry)
        state.updateFeature(key, { geometry: snapshot.geometry })
        // 중심점이 움직이면 동심원도 따라 움직인다. 링 갱신은 기록하지 않는다 — Undo 가 반경으로 다시 그린다.
        if (snapshot.geometry.type === 'Point') {
          const radii = state.ringRadii(key)
          if (radii.length) state.setRings(key, radii, false)
        }
      })
    })
```

- [ ] **Step 4: 단축키 핸들러 교체** (330~336행 `// 마지막 점 되돌리기` 블록 전체)

```ts
    // 작도 중에는 Terra Draw 자체 undo(마지막 점 제거, F-10), 그 밖에는 스토어 Undo(F-11).
    // 한 키에 두 undo 가 같이 돌면 안 된다.
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      const isUndo = key === 'z' && !e.shiftKey
      const isRedo = (key === 'z' && e.shiftKey) || key === 'y'
      if (!isUndo && !isRedo) return
      // 입력칸 안에서는 브라우저 기본 되돌리기를 쓴다 (D1 — 텍스트는 Undo 대상이 아니다).
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      const state = useStore.getState()
      if (state.drawMode !== 'select' && state.drawMode !== 'delete') {
        if (isUndo && draw.canUndo()) draw.undo()
        return
      }
      e.preventDefault()
      if (isUndo) state.undo()
      else state.redo()
    }
    window.addEventListener('keydown', onKey)
```

- [ ] **Step 5: 동기화 이펙트에 지오메트리 역반영 단계**

`orphans` 처리 블록 뒤, 이펙트 닫기 전에:

```ts
    // 스토어 지오메트리가 바뀌었는데 TD 는 그대로인 경우 — Undo/Redo 로 편집을 되돌렸을 때.
    // 드래그 중에는 건너뛴다. 이펙트가 도는 사이 TD 가 더 움직였을 수 있어서 옛 값을 되밀면 튄다.
    if (!editBaseline.current.size) {
      drawable.forEach((f) => {
        if (!syncedIds.current.has(f.id)) return
        const snap = draw.getSnapshotFeature(f.id)
        if (snap && JSON.stringify(snap.geometry) !== JSON.stringify(f.geometry)) {
          draw.updateFeatureGeometry(f.id, f.geometry as GeoJSONStoreFeatures['geometry'])
        }
      })
    }
```

동기화 이펙트 위 주석 블록에 한 줄 추가: `- 갱신: Undo/Redo 로 스토어 지오메트리만 바뀐 경우 TD 에 되민다.`

- [ ] **Step 6: 타입체크** — `npm run typecheck` PASS

- [ ] **Step 7: 브라우저 확인 (Playwright MCP)** — 스펙 6절 7·9번

1. 사각형 작도 → 선택 모드에서 꼭짓점 하나를 **한 번** 드래그 → Ctrl+Z **한 번**에 원래 모양 (드래그 합치기 확인. 여러 번 눌러야 하면 finish 가 오지 않는 것 — `context.action` 을 console 로 찍어 원인을 본다)
2. Ctrl+Shift+Z → 드래그 후 모양
3. 작도 → 드래그 → 정보 페이지 `삭제` 순으로 한 뒤 Ctrl+Z 3번: 복원 → 원래 모양 → 사라짐
4. 점 + 동심원 → 점을 끌어 옮김 → Ctrl+Z → 점과 링이 함께 원위치, 지도에 옛 링이 남지 않음
5. 제목 입력칸에 글자 입력 후 Ctrl+Z → 글자만 지워지고 도형은 그대로
6. 폴리곤 도구로 점 3개 찍는 중 Ctrl+Z → 마지막 점만 빠짐 (F-10 유지)

- [ ] **Step 8: 커밋**

```bash
git add src/map/MapView.tsx
git commit -m "feat: 꼭짓점·이동 편집 Undo 와 단축키 통합

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Terra Draw 밖 도형 — `shapes` 소스와 선택

**Files:**
- Modify: `src/map/MapView.tsx`, `src/ui/InfoPage.tsx`

**Interfaces:**
- Consumes: `isEditable` (Task 2), `isRing` (Task 3)
- Produces: MapLibre 레이어 id `shapes-fill`, `shapes-line` (Task 8 의 대상 선택이 `shapes-fill` 을 조회한다)

- [ ] **Step 1: 소스·레이어** — `map.on('load')` 안, `pointIcons` 소스 옆에

```ts
      // Terra Draw 가 담지 못하는 도형(MultiPolygon·구멍 있는 Polygon). 선택은 되지만 꼭짓점 편집은 없다.
      map.addSource('shapes', { type: 'geojson', data: EMPTY })
      map.addLayer({
        id: 'shapes-fill',
        type: 'fill',
        source: 'shapes',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.2 },
      })
      map.addLayer({
        id: 'shapes-line',
        type: 'line',
        source: 'shapes',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['case', ['get', 'selected'], 4, 2],
        },
      })
```

`rings-fill` 앞에 추가해야 링이 위에 그려진다 — `addLayer` 순서를 `shapes-fill`, `shapes-line`, `rings-fill`… 로 둔다.

- [ ] **Step 2: 동기화 필터** — Task 3 에서 바꾼 줄을

```ts
    const drawable = features.filter((f) => !isRing(f) && isEditable(f.geometry))
```

`import { isEditable } from '../lib/geo/editable'`

- [ ] **Step 3: 렌더 이펙트** — "포인트 표시 아이콘" 이펙트 앞에

```ts
  /* ---------------- Terra Draw 밖 도형 ---------------- */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource('shapes') as GeoJSONSource | undefined
    if (!source) return
    const layerOf = (id: string) => layers.find((l) => l.id === id)
    source.setData({
      type: 'FeatureCollection',
      features: features
        .filter((f) => !isRing(f) && !isEditable(f.geometry) && layerOf(f.layerId)?.visible !== false)
        .map((f) => ({
          type: 'Feature' as const,
          geometry: f.geometry,
          properties: {
            id: f.id,
            color: layerOf(f.layerId)?.style.color ?? '#2563eb',
            selected: f.id === selectedId,
          },
        })),
    })
  }, [features, layers, selectedId, mapReady])
```

- [ ] **Step 4: 클릭 선택 + 삭제 모드** — 기존 `map.on('click', ...)` 전체를 교체

```ts
    map.on('click', (e: MapMouseEvent) => {
      const state = useStore.getState()
      const shapeId = map
        .queryRenderedFeatures(e.point, { layers: ['shapes-fill', 'shapes-line'] })
        .map((f) => f.properties?.id)
        .find((id): id is string => typeof id === 'string')

      if (state.drawMode === 'select') {
        if (shapeId) state.select(shapeId)
        // TD 밖 도형이 선택된 채로 빈 곳을 누르면 선택을 푼다 (TD 는 자기 도형만 deselect 한다).
        else if (state.selectedId && !draw.hasFeature(state.selectedId)) state.select(null)
        return
      }

      if (state.drawMode !== 'delete') return
      if (shapeId) {
        state.removeFeature(shapeId)
        return
      }
      // getFeaturesAtPointerEvent 는 이 조합에서 선을 잡아내지 못했다. lngLat 조회를 쓴다.
      const hits = draw.getFeaturesAtLngLat(
        { lng: e.lngLat.lng, lat: e.lngLat.lat },
        { pointerDistance: 30, ignoreSelectFeatures: true, ignoreCoordinatePoints: true },
      )
      const hit = hits.find((f) => typeof f.id === 'string')
      if (!hit?.id) return
      draw.removeFeatures([hit.id])
      state.removeFeature(String(hit.id))
    })
```

- [ ] **Step 5: deselect 가 TD 밖 선택을 지우지 않게**

```ts
    draw.on('deselect', () => {
      const s = useStore.getState()
      // TD 밖 도형을 고르면서 TD 가 자기 선택을 푼 것이다. 클릭 순서와 무관하게 새 선택을 지킨다.
      if (s.selectedId && !draw.hasFeature(s.selectedId)) return
      s.select(null)
    })
```

- [ ] **Step 6: 선택 동기화 이펙트** — TD 밖 도형을 고르면 TD 쪽 선택을 푼다

```ts
  useEffect(() => {
    const draw = drawRef.current
    if (!draw || !selectedId) return
    if (draw.getMode() !== 'select') return
    if (!draw.hasFeature(selectedId)) {
      draw.getSnapshot()
        .filter((f) => f.properties?.selected && f.id)
        .forEach((f) => draw.deselectFeature(f.id!))
      return
    }
    try {
      draw.selectFeature(selectedId)
    } catch {
      /* 이미 선택된 경우 무시 */
    }
  }, [selectedId])
```

TD 는 선택된 도형의 `properties.selected` 를 `true` 로 둔다. Playwright 로 확인해서 아니면
`draw.getSnapshot()` 을 콘솔에 찍어 실제 키를 보고 맞춘다 (추측으로 고치지 마라).

- [ ] **Step 7: 정보 페이지 안내** — `src/ui/InfoPage.tsx`, Task 3 에서 넣은 `derived-origin` 아래에

```tsx
          {!isEditable(feature.geometry) && (
            <div data-testid="not-editable">이 도형은 꼭짓점 편집을 지원하지 않습니다</div>
          )}
```

`import { isEditable } from '../lib/geo/editable'`

- [ ] **Step 8: 타입체크** — PASS

- [ ] **Step 9: 브라우저 확인** — 이 태스크만으로는 MultiPolygon 을 만들 UI 가 없다.
Task 8 완료 후 스펙 6절 3번에서 함께 확인한다. 여기서는 기존 동작 회귀만 본다:
사각형 작도·선택·삭제 모드 삭제·빈 곳 클릭으로 선택 해제가 전과 같이 동작.

- [ ] **Step 10: 커밋**

```bash
git add src/map/MapView.tsx src/ui/InfoPage.tsx
git commit -m "feat: Terra Draw 가 담지 못하는 도형을 별도 소스로 그리고 선택

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: 연산 흐름 — `pendingOp`, OperationPanel, 미리보기, 대상 선택

**Files:**
- Modify: `src/store/useStore.ts`
- Create: `src/ui/OperationPanel.tsx`
- Modify: `src/ui/InfoPage.tsx`, `src/map/MapView.tsx`

**Interfaces:**
- Consumes: `runOp`, `describeOp`, `isArea`, `OpKind`, `OpResult` (Task 2), `featureName` (Task 3), `record` (Task 4)
- Produces (State):
  ```ts
  pendingOp: PendingOp | null
  startOp(op: OpKind, sourceId: string): void
  setOpDistance(d: number): void
  setOpTarget(id: string): void
  cancelOp(): void
  confirmOp(): void
  // export interface PendingOp { op: OpKind; sourceId: string; targetId?: string; distance?: number; result?: OpResult }
  ```
  "대상 고르는 중" = `pendingOp && pendingOp.op !== 'buffer' && !pendingOp.targetId`

- [ ] **Step 1: 스토어** (`src/store/useStore.ts`)

import: `import { describeOp, isArea, runOp, type OpKind, type OpResult } from '../lib/geo/ops'`,
`../types` 에서 `featureName` 추가.

`DrawMode` 아래에:

```ts
/** 확정 전 공간 연산. 저장하지 않는 화면 상태다. */
export interface PendingOp {
  op: OpKind
  sourceId: string
  targetId?: string
  distance?: number
  result?: OpResult
}

const DEFAULT_BUFFER_METERS = 100

function withResult(p: PendingOp, features: Feature[]): PendingOp {
  const a = features.find((f) => f.id === p.sourceId)
  const b = p.targetId ? features.find((f) => f.id === p.targetId) : undefined
  if (!a) return { ...p, result: { ok: false, reason: '원본 도형이 없습니다' } }
  return { ...p, result: runOp(p.op, a.geometry, b?.geometry, p.distance) }
}
```

`State` 에 Produces 의 필드들. 초기값 `pendingOp: null,`.

`select` 를 교체 — 다른 도형을 고르거나 선택을 풀면 미리보기를 파기한다:

```ts
  select: (selectedId) =>
    set((s) => ({
      selectedId,
      pendingOp: s.pendingOp && s.pendingOp.sourceId === selectedId ? s.pendingOp : null,
    })),
```

`undo()`·`redo()` 의 `set({ history: step.history })` 를 `set({ history: step.history, pendingOp: null })` 로 — 원본이 되돌려질 수 있다.

액션 (`recordGeometry` 위):

```ts
  startOp(op, sourceId) {
    const p: PendingOp = { op, sourceId, ...(op === 'buffer' ? { distance: DEFAULT_BUFFER_METERS } : {}) }
    set({ pendingOp: withResult(p, get().features) })
  },

  setOpDistance(distance) {
    const p = get().pendingOp
    if (!p || p.op !== 'buffer') return
    set({ pendingOp: withResult({ ...p, distance }, get().features) })
  },

  setOpTarget(targetId) {
    const { pendingOp: p, features } = get()
    if (!p || p.op === 'buffer' || targetId === p.sourceId) return
    const target = features.find((f) => f.id === targetId)
    if (!target || !isArea(target.geometry)) return
    set({ pendingOp: withResult({ ...p, targetId }, features) })
  },

  cancelOp: () => set({ pendingOp: null }),

  confirmOp() {
    const { pendingOp: p, features } = get()
    if (!p?.result?.ok) return
    const source = features.find((f) => f.id === p.sourceId)
    if (!source) return
    const sourceIds = p.op === 'buffer' ? [p.sourceId] : [p.sourceId, p.targetId!]
    const feature: Feature = {
      id: uid('ftr'),
      // D5 — 결과는 첫 번째 도형의 레이어에, 제목은 생성 방식 문자열로.
      layerId: source.layerId,
      geometry: p.result.geometry,
      title: describeOp(p.op, sourceIds.map((id) => featureName(features, id)), p.distance),
      properties: {},
      blocks: [],
      derivedFrom: { op: p.op, sourceIds, params: p.op === 'buffer' ? { distance: p.distance } : {} },
      parentId: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    // 사용자 도형에 사용자가 고른 연산을 건 결과다. 외부 제공자 응답이 섞이지 않는다.
    saveFeature(userInput(feature))
    set({
      features: [...features, feature],
      pendingOp: null,
      selectedId: feature.id,
      history: record(get().history, { label: '연산', changes: [{ kind: 'create', features: [feature] }] }),
    })
  },
```

- [ ] **Step 2: `src/ui/OperationPanel.tsx`**

```tsx
import { useState } from 'react'
import type { Geometry } from 'geojson'
import { useStore } from '../store/useStore'
import { isArea, type OpKind } from '../lib/geo/ops'

const OPS: Array<{ op: OpKind; label: string }> = [
  { op: 'buffer', label: '버퍼' },
  { op: 'union', label: '합집합' },
  { op: 'intersect', label: '교차' },
  { op: 'difference', label: '차집합' },
]

/** 정보 페이지의 `공간 연산` 섹션 (PRD F-21~F-24, F-27). 이항 연산의 두 번째 도형은 지도에서 누른다. */
export function OperationPanel({ featureId, geometry }: { featureId: string; geometry: Geometry }) {
  const pendingOp = useStore((s) => s.pendingOp)
  const startOp = useStore((s) => s.startOp)
  const setOpDistance = useStore((s) => s.setOpDistance)
  const cancelOp = useStore((s) => s.cancelOp)
  const confirmOp = useStore((s) => s.confirmOp)
  const [distance, setDistance] = useState('100')

  const area = isArea(geometry)
  const line = geometry.type === 'LineString'
  if (!area && !line) return null

  const active = pendingOp?.sourceId === featureId ? pendingOp : null
  const choices = area ? OPS : OPS.filter((o) => o.op === 'buffer')

  return (
    <div className="mt-3 rounded-xl border border-line p-2.5" data-testid="op-panel">
      <div className="mb-1.5 text-[12px] font-semibold">공간 연산</div>

      {!active ? (
        <div className="flex flex-wrap gap-1.5">
          {choices.map((o) => (
            <button
              key={o.op}
              onClick={() => {
                setDistance('100')
                startOp(o.op, featureId)
              }}
              className="touch-target rounded-lg bg-surface-sub px-3 text-[12px] font-medium hover:bg-line-soft"
              data-testid={`op-${o.op}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2 text-[12px]">
          {active.op === 'buffer' && (
            <label className="flex items-center gap-2">
              거리
              <input
                type="number"
                value={distance}
                onChange={(e) => {
                  setDistance(e.target.value)
                  setOpDistance(Number(e.target.value))
                }}
                className="w-24 rounded border border-line px-2 py-1 text-right"
                data-testid="op-distance"
              />
              m <span className="text-ink-mut">음수는 축소</span>
            </label>
          )}
          {active.op !== 'buffer' && !active.targetId && (
            <div className="text-ink-mut">대상 polygon 을 지도에서 누르세요</div>
          )}
          {active.result && !active.result.ok && (
            <div className="text-danger" data-testid="op-error">
              {active.result.reason}
            </div>
          )}
          <div className="flex gap-1.5">
            <button
              onClick={cancelOp}
              className="touch-target flex-1 rounded-lg bg-surface-sub text-[12px] font-medium"
              data-testid="op-cancel"
            >
              취소
            </button>
            <button
              onClick={confirmOp}
              disabled={!active.result?.ok}
              className="touch-target flex-1 rounded-lg bg-brand text-[12px] font-semibold text-white disabled:opacity-40"
              data-testid="op-confirm"
            >
              확정
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: InfoPage 배치** — `{coords && <RingEditor featureId={feature.id} />}` 아래에

```tsx
        <OperationPanel featureId={feature.id} geometry={feature.geometry} />
```

`import { OperationPanel } from './OperationPanel'`

- [ ] **Step 4: MapView — 미리보기 소스**

`map.on('load')` 안, `shapes` 레이어들 뒤에:

```ts
      // 확정 전 연산 결과 (F-27). 점선 윤곽 + 옅은 채움.
      map.addSource('preview', { type: 'geojson', data: EMPTY })
      map.addLayer({
        id: 'preview-fill',
        type: 'fill',
        source: 'preview',
        paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.15 },
      })
      map.addLayer({
        id: 'preview-line',
        type: 'line',
        source: 'preview',
        paint: { 'line-color': '#d97706', 'line-width': 2, 'line-dasharray': [2, 2] },
      })
```

컴포넌트 상단 셀렉터:

```ts
  const pendingOp = useStore((s) => s.pendingOp)
  const picking = useStore(
    (s) => s.pendingOp !== null && s.pendingOp.op !== 'buffer' && !s.pendingOp.targetId,
  )
```

이펙트 ("Terra Draw 밖 도형" 이펙트 뒤):

```ts
  /* ---------------- 연산 미리보기 ---------------- */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource('preview') as GeoJSONSource | undefined
    if (!source) return
    const result = pendingOp?.result
    source.setData(
      result?.ok
        ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: result.geometry, properties: {} }] }
        : EMPTY,
    )
  }, [pendingOp, mapReady])
```

- [ ] **Step 5: MapView — 대상 선택 모드**

작도 모드 이펙트 교체 (TD 를 static 으로 둬서 선택이 A 에서 옮겨가지 않게):

```ts
  useEffect(() => {
    const draw = drawRef.current
    if (!mapReady || !draw) return
    // 이항 연산의 대상을 고르는 동안은 TD 를 static 으로 둔다 (TD 가 항상 내장하는 모드).
    // 선택 모드였다면 대상을 누를 때 선택이 A 에서 B 로 옮겨가 연산이 파기된다.
    draw.setMode(picking ? 'static' : drawMode === 'delete' ? 'select' : TD_MODE[drawMode])
    const map = mapRef.current
    if (map) {
      map.getCanvas().style.cursor = picking
        ? 'crosshair'
        : drawMode === 'select' ? '' : drawMode === 'delete' ? 'not-allowed' : 'crosshair'
    }
  }, [drawMode, picking, mapReady])
```

선택 동기화 이펙트의 deps 를 `[selectedId, picking]` 으로 — 대상 선택이 끝나 select 모드로 돌아오면 A 를 다시 선택해 둔다.

`deselect` 핸들러에 — static 전환 때 TD 가 선택을 풀어도 연산을 파기하지 않는다 (버퍼 중 빈 곳 클릭은 기존대로 파기):

```ts
      if (s.pendingOp && s.pendingOp.op !== 'buffer' && !s.pendingOp.targetId) return
```

(`const s = useStore.getState()` 다음 줄)

`map.on('click')` 핸들러 맨 앞 (`const shapeId = …` 다음)에:

```ts
      const p = state.pendingOp
      if (p && p.op !== 'buffer' && !p.targetId) {
        const tdHit = draw
          .getFeaturesAtLngLat(
            { lng: e.lngLat.lng, lat: e.lngLat.lat },
            { pointerDistance: 30, ignoreSelectFeatures: true, ignoreCoordinatePoints: true },
          )
          .map((f) => f.id)
          .find((id): id is string => typeof id === 'string' && id !== p.sourceId)
        const target = tdHit ?? (shapeId !== p.sourceId ? shapeId : undefined)
        // polygon 이 아닌 도형은 setOpTarget 이 무시한다.
        // getFeaturesAtLngLat 가 static 모드에서도 도형을 돌려주는지 브라우저에서 확인한다 (Step 7-4).
        if (target) state.setOpTarget(target)
        return
      }
```

단축키 `onKey` 맨 앞에 ESC 파기 (F-27 "확정 전 이탈 시 파기"):

```ts
      if (e.key === 'Escape' && useStore.getState().pendingOp) {
        useStore.getState().cancelOp()
        return
      }
```

(이 줄은 `if (!(e.ctrlKey || e.metaKey)) return` **앞**에 둔다.)

힌트 알약: `{HINT[drawMode]}` → `{picking ? '대상 polygon 을 지도에서 누르세요 · Esc 취소' : HINT[drawMode]}`

- [ ] **Step 6: 타입체크·테스트** — `npm run typecheck && npm test` PASS

- [ ] **Step 7: 브라우저 확인 (Playwright MCP)** — 스펙 6절 1~6번. 각 결과를 스냅샷으로 확인하고 스크린샷을 남긴다.

1. 사각형 A → `op-buffer` → 점선 미리보기가 보임 → `op-distance` 를 300 → 미리보기가 커짐 → `op-confirm` → 새 도형 선택됨, `derived-origin` 이 `buffer(<A 이름>, 300m)` — `phase2a-buffer.png`
2. `op-distance` 에 `-100000` → `op-error` `버퍼 결과가 비어 있습니다`, `op-confirm` disabled
3. 선 → 버퍼 50 → 확정 → 결과가 polygon 이고 면적 표시
4. 떨어진 사각형 B 작도 → A 선택 → `op-union` → 힌트가 `대상 polygon…` → B 클릭 → 미리보기 두 조각 → 확정 → 결과가 `shapes` 로 그려지고 `not-editable` 표시. 빈 곳 클릭 → 선택 해제, 결과를 다시 클릭 → 정보 페이지 열림 — `phase2a-union-multi.png`
5. A 선택 → `op-intersect` → B 클릭 → `겹치는 영역이 없습니다`
6. 큰 사각형 C 와 그 안의 작은 사각형 D → C 선택 → `op-difference` → D 클릭 → 확정 → 구멍 난 도형, 면적 < C 면적 — `phase2a-difference.png`
7. 미리보기 중 Esc → 미리보기 사라짐. 미리보기 중 다른 도형 선택 → 사라짐
8. 4의 결과를 Ctrl+Z → 사라짐, Ctrl+Shift+Z → 다시 나타남
9. 새로고침 → 결과 도형들과 `생성 방식` 이 그대로

- [ ] **Step 8: 커밋**

```bash
git add src/store/useStore.ts src/ui/OperationPanel.tsx src/ui/InfoPage.tsx src/map/MapView.tsx docs/screenshots/phase2a-*.png
git commit -m "feat: 버퍼·합집합·교차·차집합 미리보기와 확정

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: 마무리 — 회귀 점검과 문서

**Files:**
- Modify: `CLAUDE.md`, `docs/superpowers/specs/2026-09-23-phase2a-geo-ops-undo-design.md` (D6 한 줄)

- [ ] **Step 1: 빌드·게이트 점검**

```bash
npm run build
cat > src/__gate.ts <<'EOF'
import { fromProvider } from './persist/persistable'
import { geocoder } from './providers/geocoding'
export const x = fromProvider(geocoder, { a: 1 })
EOF
npx tsc -b --force        # TS2345 가 나야 정상
rm src/__gate.ts
npm test
```

Expected: build 성공, tsc 는 TS2345 **로 실패**, test 전부 PASS.

- [ ] **Step 2: 모바일 회귀 (Playwright, 390×844)**

바텀시트에서 정보 페이지 → 공간 연산 섹션 버튼이 44px 이상, 하단 툴바에 되돌리기·다시 하기가 보이고 누를 수 있다 — `phase2a-mobile.png`

- [ ] **Step 3: 문서**

`CLAUDE.md`:
- `## 명령` 블록에 `npm test            # node:test — src/lib/geo 와 store/history 순수 함수` 추가
- "**테스트 러너가 없다.**" 문단을 다음으로 교체:
  "순수 함수(`src/lib/geo/`, `src/store/history.ts`)는 Node 24 내장 `node:test` 로 테스트한다(`tests/`). 이 파일들은 Node 가 직접 실행하므로 **상대경로 런타임 import 를 두지 마라**. UI·지도 동작은 여전히 Playwright MCP 로 브라우저를 직접 몰아 확인한다 — 이 프로젝트에서 실제로 난 버그는 대부분 타입을 통과했다."
- `### 지오메트리 소유권` 에 한 단락 추가:
  "- **Terra Draw 는 MultiPolygon·구멍 있는 Polygon 을 거부한다.** 그런 도형(주로 연산 결과)은 `isEditable()` 로 걸러 `shapes` 소스로 그리고, 선택만 되고 꼭짓점 편집은 없다. `derivedFrom` 이 있다고 링인 것은 아니다 — 링 판정은 `isRing()` 을 써라."
- `### 저장 경로` 아래에 `### Undo/Redo` 한 단락:
  "`store/history.ts` 는 스냅샷이 아니라 변경 기록(create/delete/geometry)이다. 드래그는 첫 `change` 에서 기준선을 잡고 `finish`(action ≠ draw)에서 한 번 기록한다. 동심원 링 id 는 `rng_${centerId}_${radius}` 로 결정적이다 — 무작위로 바꾸면 Undo 후 고아 링이 남는다."

스펙 D6 행을 다음으로 교체:
`| D6 | 새 의존성 없이 순수 함수는 Node 내장 node:test 로, UI 는 Playwright MCP 로 검증한다 | CLAUDE.md 의 기존 검증 방식 + 계산 로직 TDD |`

- [ ] **Step 4: 커밋**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-09-23-phase2a-geo-ops-undo-design.md docs/screenshots/phase2a-mobile.png
git commit -m "docs: Phase 2-A 구현 사실을 CLAUDE.md 에 반영

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: 결과 보고** — 스펙 1절 완료 기준 6개 각각의 확인 결과와 스크린샷 경로, 확인하지 못한 항목이 있으면 그 이유.
