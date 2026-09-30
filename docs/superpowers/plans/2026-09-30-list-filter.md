# 목록 필터 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 목록 패널에서 스키마 필드(number·text)에 AND 조건을 걸어, 목록·지도 도형·아이콘을 함께 거른다.

**Architecture:** 판정은 `src/filter.ts` 순수 함수. 조건은 zustand 스토어 `filters` 에만 (서버·localStorage 없음).
`FeatureList`(목록), `MapView` 동기화 이펙트(Terra Draw 도형), `MapView` `pointIcons` 이펙트(아이콘) 세 곳이 같은
`activeFilter(filters, layers)` 결과로 거른다. 지도에서는 선택된 도형이 필터를 건너뛴다.

**Tech Stack:** React 19 · TS strict · zustand · Tailwind v4 · MapLibre · Terra Draw · `node --test`(Node 22 타입 제거)

**Spec:** `docs/superpowers/specs/2026-09-30-list-filter-design.md` — 결정 D1~D11 을 이 계획이 그대로 따른다.

## Global Constraints

- 도메인 용어(매물·단지·세대 등)를 `src/` 코드에 넣지 않는다 (불변 규칙 6). 필드 라벨은 스키마에서 온다.
- `src/filter.ts` 는 `import type` 만 쓴다 — `node --test` 가 확장자 없는 런타임 import 를 못 푼다 (`src/map/pointSize.ts` 와 같은 규칙).
- zustand 셀렉터 안에서 배열·객체를 파생하지 않는다. 파생은 `useMemo` (CLAUDE.md 함정).
- 지도 동기화에서 도형마다 `updateFeatureProperties` 를 부르지 않는다. 추가·제거는 `addFeatures`/`removeFeatures` 배치.
- 모바일(`embedded`) 입력·버튼은 `touch-target`(44px) + 글자 16px. 판단은 `pointer: coarse` 가 아니라 레이아웃(`embedded`).
- 연산자: 숫자 `이상 / 이하 / 사이`(경계 포함), 텍스트 `포함`(대소문자·앞뒤 공백 무시). 조건은 AND.
- 필터 상태는 스토어에만. `repo.ts` 를 거치지 않는다.
- Windows 에서는 `npm test` 의 따옴표 glob 이 안 풀려 `tests 0` 으로 통과한 척한다 → `node --test tests/*.test.ts` 로 돌린다.
- git 작성자: 이 PC 는 `Metanet` 으로 찍힌다 (사용자에게 보고함, 결정 대기). 계획 실행 중 바꾸지 않는다.

## Review Focus

1. **스키마 필드 타입이 바뀐 조건** (`number` → `text` 로 고침) — 연산자가 필드 타입과 안 맞는 조건은 판정에서 빠져야 한다 (전부 0건이 되면 안 된다). → Task 1 테스트.
2. **숫자가 문자열로 저장된 속성** (`"1000"`, `"1,000"`) — 사람이 숫자로 읽는 값은 숫자 조건에 걸려야 한다. → Task 1 테스트.
3. **`사이` 의 최소·최대를 거꾸로 입력** (`800 ~ 300`) — 300~800 으로 읽는 것이 자연스럽다. → Task 1 테스트.
4. **Terra Draw 에서 선택된 채로 필터에 걸리는 도형** — 정보 페이지를 닫아 스토어 선택이 풀리는 순간 TD 가 선택 상태로 들고 있는 도형을 `removeFeatures` 한다. 예외 없이 지워져야 한다. → Task 3 브라우저 단계.
5. **값 입력 중 매 키마다 3,288 도형 재동기화** — 입력이 버벅이지 않아야 한다. → Task 3 브라우저 단계에서 체감 확인, 느리면 보고(이 계획에서 디바운스를 미리 넣지 않는다).

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/filter.ts` (새) | 조건 타입, 필드 목록, 활성 조건 선별, 판정. 순수 함수 |
| `tests/filter.test.ts` (새) | 위 함수 단위 테스트 |
| `src/store/useStore.ts` | `filters` 상태와 `setFilters` |
| `src/ui/FilterBar.tsx` (새) | 조건 편집 패널 (`FilterPanel`) |
| `src/ui/FeatureList.tsx` | 필터 버튼·패널 배치, 목록 거르기, 개수·0건 안내 |
| `src/map/MapView.tsx` | 동기화 이펙트와 `pointIcons` 이펙트에 필터 + 선택 예외 |
| `src/App.tsx` | 모바일 하단 `목록` 버튼의 필터 점 |
| `CLAUDE.md`, `docs/HANDOFF.md`, `docs/log/2026-09-30.md` | 상태 기록 |

---

### Task 1: 필터 판정 순수 함수

**Files:**
- Create: `src/filter.ts`
- Test: `tests/filter.test.ts`

**Interfaces:**
- Consumes: `Feature`, `Layer`, `PropertySchemaField`, `PropertyType` (`src/types.ts`, 타입만)
- Produces:
  - `type FilterOp = 'gte' | 'lte' | 'between' | 'contains'`
  - `interface FilterCond { id: string; key: string; op: FilterOp; value: string | [string, string] }`
  - `opsFor(type: PropertyType): FilterOp[]` — number → `['gte','lte','between']`, text → `['contains']`, 그 외 `[]`
  - `filterFields(layers: Layer[], opts: { visibleOnly: boolean }): PropertySchemaField[]`
  - `activeConds(conds: FilterCond[], fields: PropertySchemaField[]): FilterCond[]`
  - `activeFilter(conds: FilterCond[], layers: Layer[]): FilterCond[]` — `activeConds(conds, filterFields(layers, { visibleOnly: true }))`
  - `matches(feature: Feature, conds: FilterCond[]): boolean` — conds 는 `activeConds` 를 거친 것이라고 가정

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/filter.test.ts`

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activeConds, activeFilter, filterFields, matches, opsFor, type FilterCond } from '../src/filter.ts'
import type { Feature, Layer, PropertySchemaField } from '../src/types.ts'

const layer = (id: string, schema: PropertySchemaField[], visible = true): Layer => ({
  id, projectId: 'p', name: id, kind: 'vector', visible, order: 0, schema, locked: false,
  style: { color: '#000', opacity: 1, strokeWidth: 1, pointRadius: 6 },
})
const feat = (properties: Feature['properties']): Feature => ({
  id: 'f', layerId: 'A', title: 'f', blocks: [], createdAt: '', updatedAt: '',
  geometry: { type: 'Point', coordinates: [0, 0] }, properties,
})
const num = (key: string, label = key, unit?: string): PropertySchemaField =>
  ({ key, label, type: 'number', ...(unit ? { unit } : {}) })
const txt = (key: string, label = key): PropertySchemaField => ({ key, label, type: 'text' })
const c = (key: string, op: FilterCond['op'], value: FilterCond['value']): FilterCond => ({ id: key + op, key, op, value })

test('opsFor: number 3개, text 포함, 나머지 없음', () => {
  assert.deepEqual(opsFor('number'), ['gte', 'lte', 'between'])
  assert.deepEqual(opsFor('text'), ['contains'])
  assert.deepEqual(opsFor('date'), [])
})

test('filterFields: number·text 만, key 로 합치고 먼저 나온 정의', () => {
  const layers = [
    layer('A', [num('h', '세대A', '세대'), txt('r'), { key: 'd', label: 'd', type: 'date' }]),
    layer('B', [num('h', '세대B'), num('s')]),
  ]
  const fields = filterFields(layers, { visibleOnly: true })
  assert.deepEqual(fields.map((f) => f.key), ['h', 'r', 's'])
  assert.equal(fields[0].label, '세대A')
  assert.equal(fields[0].unit, '세대')
})

test('filterFields: visibleOnly 면 숨긴 레이어 필드 제외, 아니면 포함', () => {
  const layers = [layer('A', [num('h')]), layer('B', [num('s')], false)]
  assert.deepEqual(filterFields(layers, { visibleOnly: true }).map((f) => f.key), ['h'])
  assert.deepEqual(filterFields(layers, { visibleOnly: false }).map((f) => f.key), ['h', 's'])
})

test('activeConds: 빈 값·숫자 아님·between 반쪽은 빠진다', () => {
  const fields = [num('h'), txt('r')]
  const conds = [
    c('h', 'gte', ''), c('h', 'lte', 'abc'), c('h', 'between', ['100', '']),
    c('r', 'contains', '   '), c('h', 'gte', '1,000'), c('r', 'contains', '강남'),
  ]
  assert.deepEqual(activeConds(conds, fields).map((x) => x.value), ['1,000', '강남'])
})

test('activeConds: 필드가 목록에 없거나 연산자가 타입과 안 맞으면 빠진다', () => {
  const fields = [txt('h')] // 원래 number 였던 h 를 text 로 바꾼 상황
  const conds = [c('h', 'gte', '10'), c('gone', 'gte', '10'), c('h', 'contains', 'x')]
  assert.deepEqual(activeConds(conds, fields).map((x) => x.id), ['hcontains'])
})

test('activeFilter: 숨긴 레이어에만 있는 필드의 조건은 빠진다', () => {
  const layers = [layer('A', [num('h')]), layer('B', [num('s')], false)]
  assert.deepEqual(activeFilter([c('h', 'gte', '1'), c('s', 'gte', '1')], layers).map((x) => x.key), ['h'])
})

test('matches: 이상·이하·사이 경계 포함', () => {
  const f = feat({ h: 1000 })
  assert.equal(matches(f, [c('h', 'gte', '1000')]), true)
  assert.equal(matches(f, [c('h', 'gte', '1001')]), false)
  assert.equal(matches(f, [c('h', 'lte', '1000')]), true)
  assert.equal(matches(f, [c('h', 'lte', '999.5')]), false)
  assert.equal(matches(f, [c('h', 'between', ['1000', '1000'])]), true)
  assert.equal(matches(f, [c('h', 'between', ['1001', '2000'])]), false)
})

test('matches: 사이의 최소·최대가 거꾸로면 뒤집어 읽는다', () => {
  assert.equal(matches(feat({ h: 500 }), [c('h', 'between', ['800', '300'])]), true)
})

test('matches: 쉼표 입력과 문자열로 저장된 숫자', () => {
  assert.equal(matches(feat({ h: 1200 }), [c('h', 'gte', '1,000')]), true)
  assert.equal(matches(feat({ h: '1,200' }), [c('h', 'gte', '1000')]), true)
  assert.equal(matches(feat({ h: '많음' }), [c('h', 'gte', '1000')]), false)
})

test('matches: 키가 없으면 false, 조건이 없으면 true', () => {
  assert.equal(matches(feat({}), [c('h', 'gte', '1')]), false)
  assert.equal(matches(feat({}), [c('r', 'contains', 'a')]), false)
  assert.equal(matches(feat({}), []), true)
})

test('matches: 포함은 대소문자·앞뒤 공백 무시, 숫자·배열 값도 문자열로', () => {
  assert.equal(matches(feat({ r: '서울 Gangnam' }), [c('r', 'contains', '  gangnam ')]), true)
  assert.equal(matches(feat({ r: '서울' }), [c('r', 'contains', '부산')]), false)
  assert.equal(matches(feat({ r: 2018 }), [c('r', 'contains', '201')]), true)
  assert.equal(matches(feat({ r: ['a', 'b'] }), [c('r', 'contains', 'b')]), true)
})

test('matches: 여러 조건은 AND', () => {
  const f = feat({ h: 1500, s: 900 })
  assert.equal(matches(f, [c('h', 'gte', '1000'), c('s', 'lte', '800')]), false)
  assert.equal(matches(f, [c('h', 'gte', '1000'), c('s', 'lte', '900')]), true)
})
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/filter.test.ts`
Expected: FAIL — `Cannot find module '.../src/filter.ts'`

- [ ] **Step 3: 구현** — `src/filter.ts`

```ts
/**
 * 목록·지도 필터 (PRD F-71 의 일부 — 스펙 docs/superpowers/specs/2026-09-30-list-filter-design.md).
 * 순수 함수 — tests/filter.test.ts 가 직접 돌리므로 런타임 import 를 들이지 않는다 (`import type` 만).
 *
 * 조건 값은 입력칸 문자열 그대로 들고 있는다. 숫자로 바로 바꾸면 `1,` 같은 입력 중간 상태를 잃는다.
 * 해석이 안 되는 조건(빈 값·숫자 아님·사이의 반쪽)은 판정에서 뺀다 — 입력 도중 0건으로 깜빡이지 않게 (D4).
 * 불변 규칙 6 — 도메인 용어를 넣지 않는다. 필드 라벨은 레이어 스키마에서 온다.
 */
import type { Feature, Layer, PropertySchemaField, PropertyType } from './types'

export type FilterOp = 'gte' | 'lte' | 'between' | 'contains'

export interface FilterCond {
  id: string
  key: string
  op: FilterOp
  /** 입력칸 문자열. between 은 [최소, 최대] */
  value: string | [string, string]
}

export function opsFor(type: PropertyType): FilterOp[] {
  if (type === 'number') return ['gte', 'lte', 'between']
  if (type === 'text') return ['contains']
  return []
}

/** 쉼표·공백을 지운 뒤 숫자로. 해석이 안 되면 undefined. */
function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v !== 'string') return undefined
  const s = v.replace(/[,\s]/g, '')
  if (!s) return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

/** number·text 스키마 필드를 key 로 합친다. 같은 key 면 먼저 나온 레이어의 정의 (D2). */
export function filterFields(layers: Layer[], opts: { visibleOnly: boolean }): PropertySchemaField[] {
  const byKey = new Map<string, PropertySchemaField>()
  for (const l of layers) {
    if (opts.visibleOnly && !l.visible) continue
    for (const f of l.schema) {
      if (opsFor(f.type).length && !byKey.has(f.key)) byKey.set(f.key, f)
    }
  }
  return [...byKey.values()]
}

function parsable(c: FilterCond): boolean {
  if (c.op === 'between') {
    return Array.isArray(c.value) && toNumber(c.value[0]) !== undefined && toNumber(c.value[1]) !== undefined
  }
  if (typeof c.value !== 'string') return false
  return c.op === 'contains' ? c.value.trim() !== '' : toNumber(c.value) !== undefined
}

/** 판정에 쓸 조건만: 필드가 fields 에 있고(D5), 연산자가 필드 타입에 맞고, 값이 해석되는 것(D4). */
export function activeConds(conds: FilterCond[], fields: PropertySchemaField[]): FilterCond[] {
  const typeOf = new Map(fields.map((f) => [f.key, f.type]))
  return conds.filter((c) => {
    const type = typeOf.get(c.key)
    return type !== undefined && opsFor(type).includes(c.op) && parsable(c)
  })
}

/** 보이는 레이어 기준의 활성 조건. 목록과 지도가 같은 것을 쓴다. */
export function activeFilter(conds: FilterCond[], layers: Layer[]): FilterCond[] {
  return activeConds(conds, filterFields(layers, { visibleOnly: true }))
}

function matchOne(feature: Feature, c: FilterCond): boolean {
  const raw = feature.properties[c.key]
  if (raw === undefined) return false
  if (c.op === 'contains') {
    const hay = (Array.isArray(raw) ? raw.join(', ') : String(raw)).toLowerCase()
    return hay.includes(String(c.value).trim().toLowerCase())
  }
  const n = toNumber(raw)
  if (n === undefined) return false
  if (c.op === 'between') {
    const [a, b] = (c.value as [string, string]).map((v) => toNumber(v)!)
    return n >= Math.min(a, b) && n <= Math.max(a, b)
  }
  const t = toNumber(c.value)!
  return c.op === 'gte' ? n >= t : n <= t
}

/** 모든 조건 AND. conds 는 activeConds 를 거친 것이어야 한다. 키가 없으면 false (D3). */
export function matches(feature: Feature, conds: FilterCond[]): boolean {
  return conds.every((c) => matchOne(feature, c))
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/filter.test.ts` → Expected: 12 tests pass, 0 fail.
Run: `node --test tests/*.test.ts` → 기존 테스트 포함 전부 pass.
Run: `npm run typecheck` → 오류 없음.

- [ ] **Step 5: 커밋**

```bash
git add src/filter.ts tests/filter.test.ts
git commit -m "feat(filter): 필터 판정 순수 함수"
```

---

### Task 2: 스토어 상태 + 목록 패널 필터 UI

**Files:**
- Modify: `src/store/useStore.ts` (State 인터페이스 55~96행 부근, 초기값 105~115행, `select` 아래 액션)
- Create: `src/ui/FilterBar.tsx`
- Modify: `src/ui/FeatureList.tsx` (import, `rows` useMemo 69~78행, 헤더 104~126행, 빈 상태 129~137행)

**Interfaces:**
- Consumes: Task 1 의 `FilterCond`, `FilterOp`, `opsFor`, `filterFields`, `activeConds`, `activeFilter`, `matches`
- Produces:
  - 스토어 `filters: FilterCond[]`, `setFilters(filters: FilterCond[]): void`
  - `FilterPanel({ embedded }: { embedded: boolean })` (`src/ui/FilterBar.tsx`)
  - DOM testid: `filter-toggle`, `filter-panel`, `filter-row`, `filter-field`, `filter-op`, `filter-value`, `filter-value-min`, `filter-value-max`, `filter-remove`, `filter-add`, `filter-clear`, `filter-empty`, `filter-inactive`

- [ ] **Step 1: 스토어에 상태 추가** — `src/store/useStore.ts`

import 에 추가:

```ts
import type { FilterCond } from '../filter'
```

`State` 인터페이스의 `addressHints` 아래:

```ts
  /** 목록·지도 필터 조건 (스펙 2026-09-30 D1). 저장하지 않는다 — 새로고침하면 사라진다. */
  filters: FilterCond[]
```

`State` 의 `select(id: string | null): void` 아래:

```ts
  setFilters(filters: FilterCond[]): void
```

초기값 `addressHints: {},` 아래:

```ts
  filters: [],
```

액션 `select: (selectedId) => set({ selectedId }),` 아래:

```ts
  setFilters: (filters) => set({ filters }),
```

- [ ] **Step 2: 조건 편집 패널** — `src/ui/FilterBar.tsx`

```tsx
import { useMemo } from 'react'
import { useStore } from '../store/useStore'
import { uid, type PropertySchemaField } from '../types'
import { activeConds, filterFields, opsFor, type FilterCond, type FilterOp } from '../filter'

/**
 * 목록 헤더 아래에 펼치는 조건 편집 영역 (스펙 docs/superpowers/specs/2026-09-30-list-filter-design.md 4절).
 * 필드 목록은 보이는 레이어 기준, 라벨은 전체 레이어 기준 — 레이어를 꺼서 판정에서 빠진 조건도
 * 제목을 그려야 한다 (D5·D6). 불변 규칙 6 — 도메인 용어 없음, 라벨은 스키마에서 온다.
 */

const OP_LABEL: Record<FilterOp, string> = { gte: '이상', lte: '이하', between: '사이', contains: '포함' }

const emptyValue = (op: FilterOp): FilterCond['value'] => (op === 'between' ? ['', ''] : '')

export function FilterPanel({ embedded }: { embedded: boolean }) {
  const layers = useStore((s) => s.layers)
  const filters = useStore((s) => s.filters)
  const setFilters = useStore((s) => s.setFilters)

  const visibleFields = useMemo(() => filterFields(layers, { visibleOnly: true }), [layers])
  const allFields = useMemo(() => filterFields(layers, { visibleOnly: false }), [layers])
  const visibleKeys = useMemo(() => new Set(visibleFields.map((f) => f.key)), [visibleFields])
  const active = useMemo(
    () => new Set(activeConds(filters, visibleFields).map((c) => c.id)),
    [filters, visibleFields],
  )
  const fieldOf = (key: string): PropertySchemaField | undefined => allFields.find((f) => f.key === key)

  // 모바일 바텀시트: 44px 는 레이아웃 조건으로 보장 (불변 규칙 7). iOS 는 16px 미만 입력칸에서 확대한다.
  const ctl = embedded ? 'touch-target text-[16px]' : 'h-8 text-[12px]'
  const input = `${ctl} min-w-0 rounded-lg border border-line bg-surface px-2`

  const update = (id: string, patch: Partial<FilterCond>) =>
    setFilters(filters.map((c) => (c.id === id ? { ...c, ...patch } : c)))

  const changeField = (cond: FilterCond, key: string) => {
    const next = fieldOf(key)
    if (!next) return
    const ops = opsFor(next.type)
    // 타입이 바뀌어 지금 연산자가 안 맞으면 연산자·값을 초기화한다.
    if (ops.includes(cond.op)) update(cond.id, { key })
    else update(cond.id, { key, op: ops[0], value: emptyValue(ops[0]) })
  }

  const changeOp = (cond: FilterCond, op: FilterOp) => {
    const wasBetween = cond.op === 'between'
    update(cond.id, { op, value: wasBetween === (op === 'between') ? cond.value : emptyValue(op) })
  }

  const add = () => {
    const first = visibleFields[0]
    if (!first) return
    const op = opsFor(first.type)[0]
    setFilters([...filters, { id: uid('flt'), key: first.key, op, value: emptyValue(op) }])
  }

  return (
    <div className="flex flex-col gap-2 border-b border-line bg-surface-sub px-4 py-3" data-testid="filter-panel">
      {filters.map((cond) => {
        const field = fieldOf(cond.key)
        const inScope = visibleKeys.has(cond.key)
        const ops = field ? opsFor(field.type) : [cond.op]
        return (
          <div
            key={cond.id}
            className={`flex flex-wrap items-center gap-1.5 ${inScope ? '' : 'opacity-50'}`}
            data-testid="filter-row"
            data-active={active.has(cond.id)}
          >
            <select
              value={cond.key}
              onChange={(e) => changeField(cond, e.target.value)}
              className={`${input} flex-1`}
              data-testid="filter-field"
            >
              {!inScope && <option value={cond.key}>{field?.label ?? cond.key}</option>}
              {visibleFields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
            <select
              value={cond.op}
              onChange={(e) => changeOp(cond, e.target.value as FilterOp)}
              className={input}
              data-testid="filter-op"
            >
              {ops.map((op) => (
                <option key={op} value={op}>
                  {OP_LABEL[op]}
                </option>
              ))}
            </select>
            {cond.op === 'between' && Array.isArray(cond.value) ? (
              <>
                <input
                  value={cond.value[0]}
                  inputMode="decimal"
                  onChange={(e) => update(cond.id, { value: [e.target.value, (cond.value as [string, string])[1]] })}
                  className={`${input} w-20`}
                  data-testid="filter-value-min"
                />
                <span className="text-[11px] text-ink-mut">~</span>
                <input
                  value={cond.value[1]}
                  inputMode="decimal"
                  onChange={(e) => update(cond.id, { value: [(cond.value as [string, string])[0], e.target.value] })}
                  className={`${input} w-20`}
                  data-testid="filter-value-max"
                />
              </>
            ) : (
              <input
                value={typeof cond.value === 'string' ? cond.value : ''}
                inputMode={cond.op === 'contains' ? 'text' : 'decimal'}
                onChange={(e) => update(cond.id, { value: e.target.value })}
                className={`${input} w-24`}
                data-testid="filter-value"
              />
            )}
            {field?.unit && <span className="text-[11px] text-ink-mut">{field.unit}</span>}
            {!inScope && (
              <span className="text-[11px] text-ink-mut" data-testid="filter-inactive">
                적용 안 됨
              </span>
            )}
            <button
              onClick={() => setFilters(filters.filter((c) => c.id !== cond.id))}
              className={`${embedded ? 'touch-target' : 'h-8 w-8'} rounded-lg text-ink-mut hover:bg-surface`}
              title="조건 삭제"
              data-testid="filter-remove"
            >
              ✕
            </button>
          </div>
        )
      })}

      <div className="flex items-center">
        <button
          onClick={add}
          disabled={!visibleFields.length}
          className={`${embedded ? 'touch-target' : ''} text-[12px] font-medium text-brand disabled:text-ink-mut`}
          data-testid="filter-add"
        >
          + 조건 추가
        </button>
        <div className="flex-1" />
        {filters.length > 0 && (
          <button
            onClick={() => setFilters([])}
            className={`${embedded ? 'touch-target' : ''} text-[12px] text-ink-mut`}
            data-testid="filter-clear"
          >
            모두 지우기
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 목록에 연결** — `src/ui/FeatureList.tsx`

import 추가 (기존 import 아래):

```ts
import { activeFilter, filterFields, matches } from '../filter'
import { FilterPanel } from './FilterBar'
```

`const [sort, setSort] = useState<Sort>('recent')` 아래에 추가:

```ts
  const filters = useStore((s) => s.filters)
  const setFilters = useStore((s) => s.setFilters)
  const [filterOpen, setFilterOpen] = useState(false)
  // 필드도 조건도 없을 때만 막는다 — 조건이 남은 채 레이어를 다 끄면 지울 길이 없어진다 (D10).
  const canFilter = useMemo(
    () => filters.length > 0 || filterFields(layers, { visibleOnly: true }).length > 0,
    [filters, layers],
  )
```

기존 `rows` useMemo(69~78행)를 이것으로 교체:

```ts
  const { rows, total } = useMemo(() => {
    // 동심원 링은 파생 도형이라 목록에 넣지 않는다. 숨긴 레이어의 도형도 뺀다.
    const visible = new Set(layers.filter((l) => l.visible).map((l) => l.id))
    const list = features.filter((f) => !f.derivedFrom && visible.has(f.layerId))
    // 목록에는 선택 예외가 없다 — 선택 중엔 목록 대신 정보 페이지가 뜬다 (D7).
    const active = activeFilter(filters, layers)
    const passed = active.length ? list.filter((f) => matches(f, active)) : list
    const sorted = [...passed].sort((a, b) =>
      sort === 'title'
        ? (a.title || '제목 없음').localeCompare(b.title || '제목 없음', 'ko')
        : b.createdAt.localeCompare(a.createdAt),
    )
    return { rows: sorted, total: list.length }
  }, [features, layers, sort, filters])
```

헤더의 개수 `<span ... data-testid="feature-count">{rows.length}</span>` 를 교체:

```tsx
        <span className="text-xs font-medium text-brand" data-testid="feature-count">
          {filters.length ? `${rows.length.toLocaleString('ko-KR')} / ${total.toLocaleString('ko-KR')}` : rows.length}
        </span>
```

헤더의 `<div className="flex-1" />` 바로 뒤, 정렬 버튼 map 앞에 추가:

```tsx
        <button
          onClick={() => setFilterOpen((v) => !v)}
          disabled={!canFilter}
          aria-pressed={filterOpen}
          data-testid="filter-toggle"
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium disabled:opacity-40 ${
            embedded ? 'touch-target' : ''
          } ${filters.length ? 'bg-brand text-white' : 'border border-line text-ink-mut'}`}
        >
          필터{filters.length ? ` ${filters.length}` : ''}
        </button>
```

헤더 `</div>` 닫힘과 목록 스크롤 영역 `<div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">` 사이에 추가:

```tsx
      {filterOpen && <FilterPanel embedded={embedded} />}
```

빈 상태 블록 `{!rows.length && ( ... 아직 기록이 없습니다 ... )}` 를 교체:

```tsx
        {!rows.length && total > 0 && filters.length > 0 && (
          <div className="flex flex-col items-start gap-1.5 py-6" data-testid="filter-empty">
            <span className="text-[14px] font-semibold">조건에 맞는 도형이 없습니다</span>
            <button onClick={() => setFilters([])} className="text-[12px] font-medium text-brand">
              필터 지우기
            </button>
          </div>
        )}
        {!rows.length && total === 0 && (
          <div className="flex flex-col gap-1.5 py-6">
            <span className="text-[14px] font-semibold">아직 기록이 없습니다</span>
            <span className="text-[12px] leading-relaxed text-ink-mut">
              왼쪽 도구에서 점·선·다각형을 고르고 지도를 클릭하면 빈 정보 페이지가 만들어집니다.
            </span>
          </div>
        )}
```

(주의: `total > 0` 인데 필터 없이 0건인 경우는 없다 — 필터가 없으면 `rows = list`.)

- [ ] **Step 4: 정적 확인**

Run: `npm run typecheck` → 오류 없음.
Run: `node --test tests/*.test.ts` → 전부 pass.

- [ ] **Step 5: 브라우저 확인 (목록만)** — `npm run dev` 를 백그라운드로 띄우고 Playwright MCP 로
  `http://localhost:5173/?p=92e81c2e-4607-4449-aa37-3dd8ed38bf46` 를 연다 (1280×800).
  1. 레이어 패널에서 이름이 `월간선도50 TOP1~10 (시세총액)` … `월간선도50 TOP41~50 (시세총액)`, `월간선도50 순위 밖 (시세총액)` 인
     6개만 켜고 나머지는 끈다. `feature-count` 가 3,288 인지 본다 (다르면 그 값을 기록하고 계속 — 사용자 메모 도형이 섞였을 수 있다).
  2. `filter-toggle` → `filter-add` → 필드 `총세대수`, 연산자 `이상`, 값 `1000`.
     개수가 `N / 3,288` 로 바뀐다.
  3. 조건 하나 더: `역까지` `이하` `800`. 개수 M.
  4. 콘솔 검산 (`browser_evaluate`):
     ```js
     async () => {
       const { useStore } = await import('/src/store/useStore.ts')
       const s = useStore.getState()
       const vis = new Set(s.layers.filter(l => l.visible).map(l => l.id))
       return s.features.filter(f => !f.derivedFrom && vis.has(f.layerId)
         && Number(f.properties.households) >= 1000 && Number(f.properties.stationDistance) <= 800).length
     }
     ```
     `s.layers` 가 비어 있으면 같은 인스턴스가 아닌 것이다 — 그때는 멈추고 보고한다 (스펙 5절: 전역을 새로 노출하지 않는다).
     값이 M 과 같아야 한다.
  5. 값 칸을 비우면 그 조건이 무시되고 개수가 N 으로 돌아간다. `1,000` 입력이 `1000` 과 같은 결과.
  6. `총세대수` `이상` `999999` → `filter-empty` 안내, `필터 지우기` 로 원래대로.
  (지도는 아직 거르지 않는다 — Task 3.)

- [ ] **Step 6: 커밋**

```bash
git add src/store/useStore.ts src/ui/FilterBar.tsx src/ui/FeatureList.tsx
git commit -m "feat(filter): 목록 패널 필터 UI"
```

---

### Task 3: 지도(Terra Draw 도형·아이콘) 거르기와 선택 예외

**Files:**
- Modify: `src/map/MapView.tsx` (import, 셀렉터 104~111행 부근, 동기화 이펙트 360~396행, `pointIcons` 이펙트 483~532행)

**Interfaces:**
- Consumes: Task 1 `activeFilter`, `matches`, `FilterCond`; Task 2 스토어 `filters`
- Produces: 없음 (동작 변경만)

- [ ] **Step 1: import·파생값** — `src/map/MapView.tsx`

import 에 추가:

```ts
import { activeFilter, matches } from '../filter'
```

`const sizeRatios = useMemo(...)` 아래에 추가:

```ts
  const filters = useStore((s) => s.filters)
  // 목록과 같은 활성 조건. 셀렉터 밖에서 파생한다.
  const activeConditions = useMemo(() => activeFilter(filters, layers), [filters, layers])
```

- [ ] **Step 2: 동기화 이펙트** — 기존

```ts
    const hidden = new Set(layers.filter((l) => !l.visible).map((l) => l.id))
    const drawable = features.filter((f) => !f.derivedFrom && !hidden.has(f.layerId))
```

를 교체:

```ts
    const hidden = new Set(layers.filter((l) => !l.visible).map((l) => l.id))
    // 필터에 걸린 도형은 숨긴 레이어와 같은 경로로 빠진다. 선택된 도형은 필터만 건너뛴다 (스펙 D7) —
    // 없으면 필터 중 새로 찍은 점이 finish → select 직후 이 이펙트에 지워진다. 레이어 숨김은 건너뛰지 않는다.
    const drawable = features.filter(
      (f) =>
        !f.derivedFrom &&
        !hidden.has(f.layerId) &&
        (f.id === selectedId || matches(f, activeConditions)),
    )
```

이펙트 의존성 `[mapReady, ready, features, layers, sizeRatios]` 를
`[mapReady, ready, features, layers, sizeRatios, activeConditions, selectedId]` 로 바꾼다.

이펙트 위 주석 블록 끝(`… 13초가 걸렸다 (2026-09-29 실측). */`) 앞에 한 줄 추가:

```
     필터(src/filter.ts)도 같은 추가·제거 경로를 쓴다 — 선택이 바뀔 때마다 이 이펙트가 돈다.
```

- [ ] **Step 3: `pointIcons` 이펙트** — 기존 `wanted` 조건의 `layerOf(f.layerId)?.visible !== false,` 뒤에 한 줄 추가:

```ts
        (f.id === selectedId || matches(f, activeConditions)),
```

의존성 `[features, layers, mapReady, sizeRatios]` 를 `[features, layers, mapReady, sizeRatios, activeConditions, selectedId]` 로.

- [ ] **Step 4: 정적 확인**

Run: `npm run typecheck` → 오류 없음. `node --test tests/*.test.ts` → pass.

- [ ] **Step 5: 브라우저 확인 (지도)** — Task 2 Step 5 의 1~3 상태(6개 레이어, 두 조건, 목록 M)에서:
  1. 지도 점 개수는 직접 셀 수 없다 — `MapView` 는 지도·Terra Draw 를 전역에 두지 않고, 확인용으로 새로 노출하지 않는다.
     그래서 둘로 나눠 확인한다: (a) 필터를 걸기 전·후를 수도권 전체가 보이는 줌에서 `browser_take_screenshot` 로 찍어
     외곽(역에서 먼) 단지 점이 사라졌는지 눈으로 본다. (b) 목록 행 3개(필터 통과)를 눌러 각각 지도에 점이 있는지,
     필터 전 목록에 있던 걸러진 단지 1개를 지도에서 눌러 보려 할 때 그 자리에 점이 없는지 본다.
     스펙 5절 2 의 방식이다.
  2. ★ 아이콘(TOP10 단지): 조건을 `총세대수 이상 999999` 로 바꾸면 ★ 도 모두 사라지고, 지우면 돌아온다.
  3. 선택 예외: 조건이 있는 상태에서 레이어 하나를 활성으로 두고 점 도구로 지도에 점을 찍는다 →
     정보 페이지가 열리고 점이 보인다. 정보 페이지를 닫으면 점이 사라진다(속성이 없어 필터에 걸린다).
     콘솔에 Terra Draw 오류가 없어야 한다 (`browser_console_messages`) — Review Focus 4.
     필터를 지우면 그 점이 다시 보인다. 끝나면 그 점을 지운다 (정보 페이지 → 삭제).
  4. 목록 행을 눌러 필터를 통과한 단지로 이동 → 정보 페이지가 열리고 그 점이 지도에 있다.
  5. 값 칸에 `1`→`10`→`100`→`1000` 을 빠르게 입력해 입력이 버벅이는지 본다 (Review Focus 5). 눈에 띄게 끊기면 기록하고 보고.
  스크린샷: `docs/screenshots/filter-01-before.png`, `filter-02-after.png`.

- [ ] **Step 6: 커밋**

```bash
git add src/map/MapView.tsx docs/screenshots/filter-01-before.png docs/screenshots/filter-02-after.png
git commit -m "feat(filter): 지도 도형·아이콘도 필터로 거르고 선택 도형은 예외"
```

---

### Task 4: 모바일 — 하단 `목록` 버튼 필터 점 + 바텀시트 확인

**Files:**
- Modify: `src/App.tsx` (import, 셀렉터 33~36행, 모바일 `open-list-sheet` 버튼 115~124행)

**Interfaces:**
- Consumes: Task 1 `activeFilter`; 스토어 `filters`, `layers`
- Produces: testid `list-filter-dot`

- [ ] **Step 1: 점 표시** — `src/App.tsx`

import 추가 (`useMemo` 가 react import 에 없으면 함께 넣는다):

```ts
import { activeFilter } from './filter'
```

셀렉터들 아래(모바일·PC 분기 전, 컴포넌트 본문 최상단 훅 영역)에 추가:

```ts
  const filters = useStore((s) => s.filters)
  const layers = useStore((s) => s.layers)
  // 시트를 닫아도 필터는 지도에 남는다. 점이 왜 적은지 보이게 목록 버튼에 표시한다 (스펙 1절 5).
  const filterOn = useMemo(() => activeFilter(filters, layers).length > 0, [filters, layers])
```

모바일 `data-testid="open-list-sheet"` 버튼의 내용 `목록` 을 교체:

```tsx
            목록
            {filterOn && (
              <span
                className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-brand align-middle"
                data-testid="list-filter-dot"
                aria-label="필터 적용 중"
              />
            )}
```

- [ ] **Step 2: 정적 확인** — `npm run typecheck`, `node --test tests/*.test.ts`.

- [ ] **Step 3: 브라우저 확인 (390×844)** — `browser_resize` 390×844 후 새로고침(필터는 사라진다 — D1 확인도 겸함).
  1. ☰ 로 6개 레이어 상태 확인(Task 2 에서 켠 상태가 서버에 저장돼 있다) → `목록` → `필터` → 조건 추가.
     입력·버튼 높이가 44px 이상인지 `browser_evaluate` 로 `getBoundingClientRect().height` 확인, 입력 글자 16px.
  2. 조건 `총세대수 이상 1000` → 시트를 닫는다 → `list-filter-dot` 이 보인다. 조건을 지우면 사라진다.
  3. 값이 빈 조건만 있으면 점이 없다 (활성 조건 기준).
  스크린샷: `docs/screenshots/filter-03-mobile.png`, `filter-04-mobile-dot.png`.

- [ ] **Step 4: 커밋**

```bash
git add src/App.tsx docs/screenshots/filter-03-mobile.png docs/screenshots/filter-04-mobile-dot.png
git commit -m "feat(filter): 모바일 목록 버튼에 필터 적용 표시"
```

---

### Task 5: 경계 동작 확인과 문서

**Files:**
- Modify: `CLAUDE.md:262-264` (목록 설명 문단)
- Modify: `docs/HANDOFF.md` ("지금 상태 한 줄" 절)
- Create: `docs/log/2026-09-30.md`

- [ ] **Step 1: 경계 동작 브라우저 확인** (1280×800)
  1. D5: 조건 `역까지 이하 800` 이 있는 상태에서 6개 레이어를 모두 끈다 → 조건 줄이 흐려지고 `적용 안 됨`,
     `filter-toggle` 은 여전히 눌린다(D10). 레이어를 다시 켜면 조건이 살아나 개수가 돌아온다.
  2. 레이어를 모두 끄고 조건도 지우면 `filter-toggle` 이 비활성.
  3. `사이` 에 `800`·`300` 을 넣으면 `300~800` 결과와 같다.
  4. `npm run build` 통과.
  스크린샷: `docs/screenshots/filter-05-inactive.png`.

- [ ] **Step 2: `CLAUDE.md` 수정** — 262~264행의

```
- 목록은 `ui/FeatureList.tsx` 가 우측 패널(모바일은 바텀시트)에 상시 띄운다. 행을 누르면
  point 는 `flyTo`, 나머지는 bbox `fitBounds` 로 이동한 뒤 정보 페이지를 연다.
  정렬·필터가 붙는 **테이블 뷰**는 여전히 Phase 2 다.
```

을 다음으로 교체:

```
- 목록은 `ui/FeatureList.tsx` 가 우측 패널(모바일은 바텀시트)에 상시 띄운다. 행을 누르면
  point 는 `flyTo`, 나머지는 bbox `fitBounds` 로 이동한 뒤 정보 페이지를 연다.
  **필터(F-71 일부)는 있다** — `src/filter.ts` 판정을 목록·지도 동기화·`pointIcons` 세 곳이 같이 쓴다. 조건은 스토어에만(새로고침하면 사라짐),
  지도에서는 선택 도형이 예외, 동심원은 거르지 않는다. 스펙 `docs/superpowers/specs/2026-09-30-list-filter-design.md`.
  **테이블 뷰**(F-70·72~75)는 여전히 Phase 2 다.
```

- [ ] **Step 3: `docs/HANDOFF.md`** — "지금 상태 한 줄" 절의 `npm test` 줄 앞에 문단 추가:

```
**목록 필터 (2026-09-30)** — Phase 2-B 의 F-71 만 먼저 했다. 목록 헤더 `필터` 로 number·text 스키마 필드에 AND 조건
(`이상/이하/사이/포함`), 목록·지도가 같이 걸러진다. 조건은 저장하지 않는다. 동기는 `docs/book/Location.json` 입지 체크리스트로
월간선도50 을 좁혀 보는 것 — 다음은 스펙 7절의 데이터 추가(0순위: 진입가·준공연도 숫자 필드). 이 PC 의 `.env` 에는 이제 `MOLIT_KEY` 가 있다.
설계 `docs/superpowers/specs/2026-09-30-list-filter-design.md`, 계획 `docs/superpowers/plans/2026-09-30-list-filter.md`.
```

- [ ] **Step 4: `docs/log/2026-09-30.md`** — 이 세션 기록. 기존 로그(`docs/log/2026-09-29.md`)의 형식을 먼저 읽고 따른다. 담을 것:
  PRD 진행 현황 대조 결과(Phase 1 26개 완료, Phase 3 은 F-81 만, Phase 2·4 미착수, 2-A 는 설계·계획만),
  점수 레이어 대신 필터를 고른 경위, Task 2~5 브라우저 확인에서 실제로 나온 개수(N, M)와 Review Focus 4·5 관찰 결과,
  git 작성자가 `Metanet` 으로 찍히는 문제(사용자 결정 대기).

- [ ] **Step 5: 최종 확인과 커밋**

Run: `node --test tests/*.test.ts` → pass. `npm run typecheck` → 통과. `npm run build` → 통과.

```bash
git add CLAUDE.md docs/HANDOFF.md docs/log/2026-09-30.md docs/screenshots/filter-05-inactive.png
git commit -m "docs: 목록 필터 기록"
```

push 는 하지 않는다 (`main` push = 배포). 사용자에게 묻는다.
