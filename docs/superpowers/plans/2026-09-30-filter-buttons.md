# 필터 버튼 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 목록 패널 필터를 아실식 항목별 버튼 묶음으로 바꾸고, 진입가·입주년차 숫자 속성과 버튼 값을 데이터에 넣고, PC 우측 패널을 접을 수 있게 한다.

**Architecture:** 버튼 값은 레이어 스키마 필드의 `presets`(데이터). 버튼은 기존 `filters: FilterCond[]` 를 만드는 입구일 뿐이다(`togglePreset`). 스크립트가 원본 단지에 `entryPrice`·`ageYears` 를 쓰고(`price.ts`), `scripts/presets` 가 모든 레이어 스키마에 버튼 값을 덮어쓴다.

**Tech Stack:** React 19 · TS strict · zustand · Tailwind v4 · Node 22+ `node --test` · Supabase REST(anon + `x-project-id`)

**Spec:** `docs/superpowers/specs/2026-09-30-filter-buttons-design.md` (E1~E13, 8절 버튼 값 표)

## Global Constraints

- `src/` 에 도메인 용어·버튼 값을 넣지 않는다 (불변 규칙 6). 값은 `scripts/presets/presets.ts` 에만.
- `src/filter.ts`·`scripts/presets/presets.ts`·`scripts/lead50/build.ts` 는 테스트가 직접 돌리므로 확장자 없는 런타임 import 금지 (`import type` 또는 `.ts` 확장자).
- zustand 셀렉터 안 파생 금지. 모바일(`embedded`) 버튼·입력은 `touch-target`.
- 스크립트는 자기 키(`entryPrice`·`ageYears`·스키마 `presets`)만 바꾼다 (lead50 D7). 실데이터 쓰기 전에 항상 `--dry-run`.
- Windows 테스트는 `node --test tests/*.test.ts` (`npm test` 는 0개로 통과한 척한다).
- 브랜치 `feat/list-filter` 위에 이어서 커밋한다 (앞 작업이 아직 병합 전). push 하지 않는다.
- 브라우저 확인에서 레이어 표시를 바꾸면 끝에 원래대로 돌린다 (지금 보이는 레이어: 관광지, 진입가 3~5억 (월간선도50)).

## Review Focus

1. **앱 탭이 열린 채 스크립트가 스키마를 바꾸는 경우** — 앱이 옛 스키마를 들고 있다가 레이어를 저장(표시 토글 등)하면 `presets` 가 덮여 사라질 수 있다. 스크립트 실행 후 앱을 새로고침해야 한다는 것을 문서에 남기고, Task 4 에서 새로고침 후 버튼이 보이는지 확인한다.
2. **같은 key 에 직접 입력 조건이 여러 개 있을 때 버튼을 누름** — 버튼 하나로 바뀌어야 한다(E4). → Task 1 테스트.
3. **`between` 프리셋 값 비교** — 배열 값이 같은 내용이면 켜짐으로 보여야 한다. → Task 1 테스트.
4. **입력 중인 빈 조건이 있는데 버튼을 누름** — 같은 key 면 빈 조건도 사라지고, 다른 key 빈 조건은 남아 직접 입력이 펼쳐진 채여야 한다. → Task 1 테스트(`togglePreset` 다른 key 보존, `hasManualConds` 빈 조건 true).
5. **PC 우측 패널을 접은 채 지도에서 도형 클릭** — 패널이 자동으로 펼쳐져 정보 페이지가 보여야 한다(E12). → Task 6 브라우저.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/types.ts` | `FilterOp`·`FilterPreset` 타입, `PropertySchemaField.presets` |
| `src/filter.ts` | `presetFields`·`presetOn`·`togglePreset`·`hasManualConds` 추가, `FilterOp` re-export |
| `tests/filter.test.ts` | 위 함수 테스트 |
| `scripts/presets/presets.ts` (새) | 버튼 값 표 + `withPresets` (순수) |
| `scripts/presets/run.ts` (새) | `syncPresets` + CLI |
| `tests/presets.test.ts` (새) | `withPresets` 테스트 |
| `scripts/lead50/build.ts` | SCHEMA 2필드, `entryPriceOf`·`ageYearsOf`, `buildProperties`·`priceRows` 확장 |
| `scripts/lead50/run.ts` | 끝에서 `syncPresets` |
| `tests/lead50.test.ts` | 새 함수·확장 테스트 |
| `src/ui/FilterBar.tsx` | 버튼 묶음 + 더보기 + 직접 입력 |
| `src/ui/FeatureList.tsx` | 토글 disabled (E13) |
| `src/App.tsx` | PC 우측 패널 접기 (E12) |
| `CLAUDE.md`, `docs/HANDOFF.md`, `docs/log/2026-09-30.md` | 기록 |

---

### Task 1: 버튼 판정 순수 함수

**Files:**
- Modify: `src/types.ts:18-25` (`PropertySchemaField`)
- Modify: `src/filter.ts` (타입 import·export, 함수 추가)
- Test: `tests/filter.test.ts`

**Interfaces:**
- Produces:
  - `src/types.ts`: `type FilterOp = 'gte' | 'lte' | 'between' | 'contains'`, `interface FilterPreset { label: string; op: FilterOp; value: string | [string, string] }`, `PropertySchemaField.presets?: FilterPreset[]`
  - `src/filter.ts`: `export type { FilterOp }` (기존 import 경로 유지), `presetFields(layers: Layer[]): PropertySchemaField[]`, `presetOn(conds: FilterCond[], key: string, p: FilterPreset): boolean`, `togglePreset(conds: FilterCond[], key: string, p: FilterPreset, id: string): FilterCond[]`, `hasManualConds(conds: FilterCond[], visibleFields: PropertySchemaField[]): boolean`

- [ ] **Step 1: 실패하는 테스트** — `tests/filter.test.ts` import 줄을

```ts
import { activeConds, activeFilter, condProblem, fieldFor, filterFields, hasManualConds, matches, opsFor, presetFields, presetOn, togglePreset, type FilterCond } from '../src/filter.ts'
import type { Feature, FilterPreset, Layer, PropertySchemaField } from '../src/types.ts'
```

로 바꾸고 파일 끝에 추가:

```ts
const pre = (label: string, op: FilterCond['op'], value: FilterCond['value']): FilterPreset => ({ label, op, value })
const withP = (f: PropertySchemaField, presets: FilterPreset[]): PropertySchemaField => ({ ...f, presets })

test('presetFields: 보이는 레이어의 presets 있는 number 필드만, 순서 유지', () => {
  const layers = [
    layer('A', [txt('r'), withP(num('h'), [pre('1000~', 'gte', '1000')]), num('n'), withP(txt('t'), [pre('x', 'contains', 'x')])]),
    layer('B', [withP(num('s'), [pre('500m', 'lte', '500')])], false),
    layer('C', [withP(num('d'), [pre('30분', 'lte', '30')])]),
  ]
  assert.deepEqual(presetFields(layers).map((f) => f.key), ['h', 'd'])
})

test('presetOn: 같은 key·op·value 면 켜짐, between 은 배열 내용 비교', () => {
  const p = pre('1000~', 'gte', '1000')
  assert.equal(presetOn([c('h', 'gte', '1000')], 'h', p), true)
  assert.equal(presetOn([c('h', 'gte', '1,000')], 'h', p), false)
  assert.equal(presetOn([c('h', 'lte', '1000')], 'h', p), false)
  assert.equal(presetOn([c('x', 'gte', '1000')], 'h', p), false)
  const b = pre('3~5억', 'between', ['3', '5'])
  assert.equal(presetOn([c('e', 'between', ['3', '5'])], 'e', b), true)
  assert.equal(presetOn([c('e', 'between', ['3', '6'])], 'e', b), false)
})

test('togglePreset: 같은 key 조건을 모두 지우고 버튼 조건 하나, 다른 key 는 그대로', () => {
  const conds = [c('h', 'gte', '500'), c('h', 'lte', '3000'), c('s', 'lte', '800'), c('x', 'gte', '')]
  const next = togglePreset(conds, 'h', pre('1000~', 'gte', '1000'), 'new')
  assert.deepEqual(next.map((x) => [x.key, x.op, x.value]), [['s', 'lte', '800'], ['x', 'gte', ''], ['h', 'gte', '1000']])
  assert.equal(next[2].id, 'new')
})

test('togglePreset: 켜진 버튼을 다시 누르면 그 key 조건이 모두 빠진다', () => {
  const conds = [c('h', 'gte', '1000'), c('s', 'lte', '800')]
  assert.deepEqual(togglePreset(conds, 'h', pre('1000~', 'gte', '1000'), 'new').map((x) => x.key), ['s'])
})

test('togglePreset: between 프리셋 값은 복사해 넣는다 (공유 배열 아님)', () => {
  const p = pre('3~5억', 'between', ['3', '5'])
  const next = togglePreset([], 'e', p, 'id')
  assert.deepEqual(next[0].value, ['3', '5'])
  assert.notEqual(next[0].value, p.value)
})

test('hasManualConds: 버튼으로 표현 안 되는 조건이 있으면 true', () => {
  const fields = [withP(num('h'), [pre('1000~', 'gte', '1000')]), num('n')]
  assert.equal(hasManualConds([], fields), false)
  assert.equal(hasManualConds([c('h', 'gte', '1000')], fields), false)
  assert.equal(hasManualConds([c('h', 'gte', '1200')], fields), true)   // 값이 버튼과 다름
  assert.equal(hasManualConds([c('n', 'gte', '1')], fields), true)      // presets 없는 필드
  assert.equal(hasManualConds([c('gone', 'gte', '1')], fields), true)   // 적용 안 됨
  assert.equal(hasManualConds([c('h', 'gte', '')], fields), true)       // 입력 중인 빈 조건
})
```

- [ ] **Step 2: 실패 확인** — `node --test tests/filter.test.ts` → FAIL: `does not provide an export named 'hasManualConds'`

- [ ] **Step 3: 타입** — `src/types.ts` 의 `/** \`key\` 는 레이어 내 유일. */` 바로 위에 추가:

```ts
/** 필터 연산자 (src/filter.ts). 스키마 필드의 버튼 값(presets)이 참조하므로 여기에 둔다. */
export type FilterOp = 'gte' | 'lte' | 'between' | 'contains'

/** 필터 버튼 하나 — 값은 입력칸 문자열과 같은 형식. 값 자체는 데이터(스크립트가 쓰는 스키마)에만 있다 (불변 규칙 6). */
export interface FilterPreset {
  label: string
  op: FilterOp
  value: string | [string, string]
}
```

`PropertySchemaField` 의 `options?: string[]` 아래에:

```ts
  /** 필터 버튼 값 (스펙 2026-09-30 filter-buttons E1). 스크립트 소유 — 앱은 읽기만 한다. */
  presets?: FilterPreset[]
```

- [ ] **Step 4: 구현** — `src/filter.ts`

import 줄을

```ts
import type { Feature, FilterOp, FilterPreset, Layer, PropertySchemaField, PropertyType } from './types'

export type { FilterOp }
```

로 바꾸고, 기존 `export type FilterOp = 'gte' | 'lte' | 'between' | 'contains'` 줄을 지운다. 파일 끝에 추가:

```ts
/** 버튼 묶음을 그릴 필드: 보이는 레이어의 presets 있는 number 필드 (filterFields 순서 = 스키마 순서, E10). */
export function presetFields(layers: Layer[]): PropertySchemaField[] {
  return filterFields(layers, { visibleOnly: true }).filter((f) => f.type === 'number' && !!f.presets?.length)
}

const sameValue = (a: FilterCond['value'], b: FilterCond['value']): boolean =>
  Array.isArray(a) && Array.isArray(b) ? a[0] === b[0] && a[1] === b[1] : a === b

/** 버튼 켜짐 = 같은 key·op·value 조건이 있다 (E3). 직접 입력으로 같은 값을 넣어도 켜진다. */
export function presetOn(conds: FilterCond[], key: string, p: FilterPreset): boolean {
  return conds.some((c) => c.key === key && c.op === p.op && sameValue(c.value, p.value))
}

/** E4. 켜져 있으면 그 key 조건을 모두 빼고, 아니면 그 key 조건을 모두 지운 뒤 버튼 조건 하나를 넣는다. */
export function togglePreset(conds: FilterCond[], key: string, p: FilterPreset, id: string): FilterCond[] {
  const rest = conds.filter((c) => c.key !== key)
  if (presetOn(conds, key, p)) return rest
  const value: FilterCond['value'] = Array.isArray(p.value) ? [p.value[0], p.value[1]] : p.value
  return [...rest, { id, key, op: p.op, value }]
}

/** E11. 버튼으로 보이지 않는 조건(프리셋 없는 필드·버튼과 다른 값·적용 안 됨·입력 중)이 있나 — 있으면 직접 입력을 펼쳐 둔다. */
export function hasManualConds(conds: FilterCond[], visibleFields: PropertySchemaField[]): boolean {
  return conds.some((c) => {
    if (condProblem(c, visibleFields)) return true
    const presets = visibleFields.find((f) => f.key === c.key)?.presets ?? []
    return !presets.some((p) => p.op === c.op && sameValue(c.value, p.value))
  })
}
```

- [ ] **Step 5: 통과 확인** — `node --test tests/filter.test.ts` → 20 pass. `node --test tests/*.test.ts` → 전부 pass. `npm run typecheck` → 오류 없음.

- [ ] **Step 6: 커밋**

```bash
git add src/types.ts src/filter.ts tests/filter.test.ts
git commit -m "feat(filter): 버튼 값 타입과 버튼 판정 함수"
```

---

### Task 2: 버튼 값 표와 스키마 동기화 스크립트

**Files:**
- Create: `scripts/presets/presets.ts`, `scripts/presets/run.ts`
- Test: `tests/presets.test.ts`

**Interfaces:**
- Consumes: `FilterPreset`, `PropertySchemaField` (Task 1), `opsFor` (`src/filter.ts`), `Sb`·`readLayers`·`supabaseClient` (`scripts/lead50/sb.ts`)
- Produces: `PRESETS: Record<string, FilterPreset[]>`, `withPresets(schema: PropertySchemaField[]): PropertySchemaField[]`, `syncPresets(sb: Sb, projectId: string, dryRun: boolean): Promise<void>`

- [ ] **Step 1: 실패하는 테스트** — `tests/presets.test.ts`

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PRESETS, withPresets } from '../scripts/presets/presets.ts'
import { opsFor } from '../src/filter.ts'
import type { PropertySchemaField } from '../src/types.ts'

test('withPresets: 표에 있는 number 필드만 presets 를 덮어쓰고 나머지 속성은 유지', () => {
  const schema: PropertySchemaField[] = [
    { key: 'households', label: '내 세대수', type: 'number', unit: '세대', presets: [{ label: '옛 값', op: 'gte', value: '1' }] },
    { key: 'memo', label: '메모', type: 'text' },
    { key: 'stationDistance', label: '역까지', type: 'text' },   // 사용자가 text 로 바꿨으면 건드리지 않는다
  ]
  const out = withPresets(schema)
  assert.equal(out[0].label, '내 세대수')
  assert.equal(out[0].unit, '세대')
  assert.deepEqual(out[0].presets, PRESETS.households)
  assert.equal(out[1], schema[1])
  assert.equal('presets' in out[2], false)
})

test('PRESETS: 스펙 8절 key 전부, 연산자는 모두 number 연산자, 값은 숫자 문자열', () => {
  assert.deepEqual(Object.keys(PRESETS).sort(), ['ageYears', 'entryPrice', 'households', 'minCityHall', 'minSeolleung', 'minYeouido', 'pricePerPyeong', 'stationDistance'])
  for (const [key, list] of Object.entries(PRESETS)) {
    assert.ok(list.length >= 4, key)
    for (const p of list) {
      assert.ok(opsFor('number').includes(p.op), `${key} ${p.label}`)
      for (const v of Array.isArray(p.value) ? p.value : [p.value]) assert.ok(Number.isFinite(Number(v)), `${key} ${p.label}`)
    }
  }
  assert.deepEqual(PRESETS.households.map((p) => p.label), ['300~', '500~', '1000~', '2000~', '3000~'])
  assert.deepEqual(PRESETS.entryPrice.at(-1), { label: '12억~', op: 'gte', value: '12' })
})
```

- [ ] **Step 2: 실패 확인** — `node --test tests/presets.test.ts` → FAIL: `Cannot find module .../scripts/presets/presets.ts`

- [ ] **Step 3: 구현** — `scripts/presets/presets.ts`

```ts
/**
 * 필터 버튼 값 (스펙 docs/superpowers/specs/2026-09-30-filter-buttons-design.md 8절). 도메인 값은 여기에만 둔다 (불변 규칙 6).
 * 순수 — tests/presets.test.ts 가 직접 돌린다. 적용은 run.ts 의 syncPresets.
 */
import type { FilterPreset, PropertySchemaField } from '../../src/types.ts'

const le = (label: string, v: number): FilterPreset => ({ label, op: 'lte', value: String(v) })
const ge = (label: string, v: number): FilterPreset => ({ label, op: 'gte', value: String(v) })
const minutes = [le('20분', 20), le('30분', 30), le('45분', 45), le('1시간', 60)]

export const PRESETS: Record<string, FilterPreset[]> = {
  entryPrice: [le('3억 이하', 3), le('5억 이하', 5), le('6.5억 이하', 6.5), le('8억 이하', 8), le('12억 이하', 12), ge('12억~', 12)],
  households: [ge('300~', 300), ge('500~', 500), ge('1000~', 1000), ge('2000~', 2000), ge('3000~', 3000)],
  ageYears: [le('~5년', 5), le('~10년', 10), le('~15년', 15), le('~20년', 20), ge('20년~', 20), ge('30년~', 30)],
  // 분포 2026-09-30: 중앙 2,357 · 상위25% 4,037 · 상위10% 6,010 (만원)
  pricePerPyeong: [le('~1천', 1000), le('~2천', 2000), le('~3천', 3000), le('~4천', 4000), le('~6천', 6000), ge('6천~', 6000)],
  stationDistance: [le('300m', 300), le('500m', 500), le('800m', 800), le('1km', 1000)],
  minSeolleung: minutes,
  minYeouido: minutes,
  minCityHall: minutes,
}

/** 표에 있는 number 필드에만 presets 를 덮어쓴다. label·unit 등 사용자가 고친 것은 그대로 (E5). */
export function withPresets(schema: PropertySchemaField[]): PropertySchemaField[] {
  return schema.map((f) => (f.type === 'number' && PRESETS[f.key] ? { ...f, presets: PRESETS[f.key] } : f))
}
```

`scripts/presets/run.ts`

```ts
/**
 * 프로젝트의 모든 레이어 스키마에 필터 버튼 값을 맞춘다 (스펙 filter-buttons E5·E6). 사본 레이어도 key 로 같이 맞는다.
 *   node scripts/presets/run.ts <projectId> [--dry-run]
 * lead50/run.ts 가 끝에서 부른다. scripts/transit 을 돌린 뒤에도 다시 돌린다.
 * 앱 탭이 열려 있으면 새로고침한다 — 옛 스키마로 레이어를 저장하면 presets 가 덮인다.
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readLayers, supabaseClient } from '../lead50/sb.ts'
import type { Sb } from '../lead50/sb.ts'
import { withPresets } from './presets.ts'

export async function syncPresets(sb: Sb, projectId: string, dryRun: boolean): Promise<void> {
  const layers = await readLayers(sb, projectId)
  const changed = layers.filter((l) => JSON.stringify(withPresets(l.schema)) !== JSON.stringify(l.schema))
  console.log(JSON.stringify({ layers: layers.length, changed: changed.map((l) => l.name), dryRun }, null, 2))
  if (dryRun) return
  for (const l of changed) {
    await sb(`layers?id=eq.${l.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ schema: withPresets(l.schema) }) })
  }
  console.error(`버튼 값 기록 완료: 레이어 ${changed.length}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [projectId] = process.argv.slice(2)
  if (!projectId || !/^[0-9a-f-]{36}$/.test(projectId)) {
    console.error('usage: node scripts/presets/run.ts <projectId> [--dry-run]')
    process.exit(2)
  }
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)))
  await syncPresets(supabaseClient(projectId), projectId, process.argv.includes('--dry-run'))
}
```

- [ ] **Step 4: 통과 확인** — `node --test tests/presets.test.ts` → 2 pass. `node --test tests/*.test.ts` → 전부 pass. `npm run typecheck` → 오류 없음 (tsconfig.node 가 scripts 포함).

- [ ] **Step 5: 커밋**

```bash
git add scripts/presets tests/presets.test.ts
git commit -m "feat(presets): 필터 버튼 값 표와 스키마 동기화 스크립트"
```

---

### Task 3: 진입가 금액·입주년차 숫자 속성

**Files:**
- Modify: `scripts/lead50/build.ts` (SCHEMA 47-60행, `entryTradeLine` 아래 함수, `buildProperties` 230-245행, `priceRows` 385-410행)
- Modify: `scripts/lead50/run.ts` (끝)
- Test: `tests/lead50.test.ts`

**Interfaces:**
- Consumes: `syncPresets` (Task 2)
- Produces: `entryPriceOf(g: AreaGroup | undefined): number | undefined`, `ageYearsOf(completion: unknown): number | undefined`, SCHEMA 키 `entryPrice`(2번째 뒤)·`ageYears`(`completion` 뒤)

- [ ] **Step 1: 실패하는 테스트** — `tests/lead50.test.ts` 의 build.ts import 목록 마지막 줄 `entryTradeLine, parsePrice, …, PRICE_LAYERS,` 뒤에 `ageYearsOf, entryPriceOf, entryGroup,` 를 넣고, 파일 끝에 추가:

```ts
test('entryPriceOf: 만원 → 억, 소수 둘째 자리', () => {
  const g = (price: number) => entryGroup(summarizeTrades([t({ price })], '2025-10-01'))
  assert.equal(entryPriceOf(g(68500)), 6.85)
  assert.equal(entryPriceOf(g(9500)), 0.95)
  assert.equal(entryPriceOf(g(120000)), 12)
  assert.equal(entryPriceOf(undefined), undefined)
})

test('ageYearsOf: KB 준공 문자열의 (N년차)', () => {
  assert.equal(ageYearsOf('03년 08월 (24년차)'), 24)
  assert.equal(ageYearsOf('26년 01월 (1년차)'), 1)
  assert.equal(ageYearsOf('03년 08월'), undefined)
  assert.equal(ageYearsOf(undefined), undefined)
  assert.equal(ageYearsOf(24), undefined)
})

test('SCHEMA: entryPrice 는 entryTrade 뒤, ageYears 는 completion 뒤, 둘 다 number', () => {
  const keys = SCHEMA.map((f) => f.key)
  assert.equal(keys[keys.indexOf('entryTrade') + 1], 'entryPrice')
  assert.equal(keys[keys.indexOf('completion') + 1], 'ageYears')
  assert.equal(SCHEMA.find((f) => f.key === 'entryPrice')?.type, 'number')
  assert.equal(SCHEMA.find((f) => f.key === 'ageYears')?.unit, '년차')
})

test('buildProperties: entryPrice·ageYears 를 채우고 없으면 키가 없다', () => {
  const p = buildProperties(complex(), summarizeTrades([t({ area: 59.9, price: 72000 }), t({ price: 95000 })], '2025-10-01'))
  assert.equal(p.entryPrice, 7.2)
  assert.equal(p.ageYears, 6)                                   // complex() 의 '21년 01월 (6년차)'
  const q = buildProperties(complex({ completion: undefined }), [])
  assert.equal('entryPrice' in q, false)
  assert.equal('ageYears' in q, false)
})

test('priceRows: entryPrice·ageYears 도 쓰고, 거래 없는 단지는 입주년차만 바뀌면 원본만 (사본 없음)', () => {
  const block = tradesBlock(summarizeTrades([t({ area: 59.9, price: 72000 })], '2025-10-01'))!
  const base: FeatureRow = {
    id: 'ftr_a', project_id: 'p', layer_id: 'lyr_band', parent_id: null, geometry: { type: 'Point', coordinates: [127, 37] },
    title: '단지', properties: { kbComplexId: '1', completion: '03년 08월 (24년차)' }, blocks: [block],
    derived_from: null, created_at: 'c', updated_at: 'u',
  }
  const noTrade: FeatureRow = { ...base, id: 'ftr_b', blocks: [] }
  const stale: FeatureRow = { ...base, id: 'ftr_c', blocks: [], properties: { kbComplexId: '3', ageYears: 9 } }   // 준공 문자열이 없어졌다
  const { originals, copies } = priceRows([base, noTrade, stale], ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'], 'now')
  const byId = new Map(originals.map((f) => [f.id, f]))
  assert.equal(byId.get('ftr_a')?.properties.entryPrice, 7.2)
  assert.equal(byId.get('ftr_a')?.properties.ageYears, 24)
  assert.equal(byId.get('ftr_b')?.properties.ageYears, 24)
  assert.equal('entryPrice' in (byId.get('ftr_b')?.properties ?? {}), false)
  assert.equal('ageYears' in (byId.get('ftr_c')?.properties ?? { ageYears: 1 }), false)
  assert.deepEqual(copies.map((c) => c.id), ['ftr_a__price'])
  assert.equal(copies[0].properties.entryPrice, 7.2)
  // 다시 돌리면 바뀐 것 없음 → updated_at 유지, 거래 없는 단지는 원본 목록에서도 빠진다
  const again = priceRows(originals, ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'], 'later')
  assert.deepEqual(again.originals.filter((f) => f.updated_at === 'later').map((f) => f.id), [])
  assert.deepEqual(again.originals.map((f) => f.id), ['ftr_a'])
})
```

- [ ] **Step 2: 실패 확인** — `node --test tests/lead50.test.ts` → FAIL: `does not provide an export named 'ageYearsOf'`

- [ ] **Step 3: 구현** — `scripts/lead50/build.ts`

SCHEMA 에서 `entryTrade` 줄 뒤와 `completion` 줄 뒤에:

```ts
  { key: 'entryPrice', label: '진입가 금액', type: 'number', unit: '억' },
```
```ts
  { key: 'ageYears', label: '입주년차', type: 'number', unit: '년차' },
```

`entryTradeLine` 함수 아래에:

```ts
/** 진입가를 억 단위 숫자로 — 필터 버튼용 (스펙 filter-buttons E7). 소수 둘째 자리라 6.5억 경계가 틀어지지 않는다. */
export function entryPriceOf(g: AreaGroup | undefined): number | undefined {
  return g && Math.round(g.latest.price / 100) / 100
}

/** KB 준공 문자열 "03년 08월 (24년차)" 의 년차 (E8). 형식이 아니면 undefined. */
export function ageYearsOf(completion: unknown): number | undefined {
  const m = typeof completion === 'string' ? /\((\d+)년차\)/.exec(completion) : null
  return m ? Number(m[1]) : undefined
}
```

`buildProperties` 의 객체에서 `entryTrade: entryTradeLine(groups),` 뒤에 `entryPrice: entryPriceOf(entryGroup(groups)),`, `completion: item.completion,` 뒤에 `ageYears: ageYearsOf(item.completion),` 를 넣는다.

`priceRows` 의 for 루프 본문을 교체:

```ts
  for (const f of source) {
    if (f.derived_from || f.parent_id || !f.properties.kbComplexId) continue
    const block = f.blocks.find((b) => b.id === TRADES_BLOCK_ID)
    const g = entryGroup(parseTradesBlock(block?.text ?? ''))
    const properties: Properties = { ...f.properties }
    setOrDelete(properties, 'ageYears', ageYearsOf(f.properties.completion))
    if (g) {
      properties.entryTrade = tradeLine(g)
      setOrDelete(properties, 'entryPrice', entryPriceOf(g))
    }
    const same = OWN_PRICE_KEYS.every((k) => properties[k] === f.properties[k])
    const original = same ? f : { ...f, properties, updated_at: now }
    // 거래 없는 단지는 입주년차가 바뀐 경우에만 원본을 쓰고, 사본은 없다.
    if (!g) {
      if (!same) originals.push(original)
      continue
    }
    originals.push(original)
    copies.push({
      ...original,
      id: `${f.id}__price`,
      layer_id: layerIds[priceBandOf(g.latest.price)],
      parent_id: null,
      blocks: block ? [block] : [],
      derived_from: null,
      updated_at: now,
    })
  }
```

`priceRows` 바로 위에:

```ts
/** priceRows 가 쓰는 원본 키 — 이것만 비교해 바뀌었는지 본다. */
const OWN_PRICE_KEYS = ['entryTrade', 'entryPrice', 'ageYears'] as const

function setOrDelete(p: Properties, key: string, v: number | undefined): void {
  if (v === undefined) delete p[key]
  else p[key] = v
}
```

`priceRows` 위 주석의 첫 줄 `원본 단지 → (진입가를 채운 원본, 가격 구간 사본).` 을
`원본 단지 → (진입가·진입가 금액·입주년차를 채운 원본, 가격 구간 사본).` 으로 고친다.

- [ ] **Step 4: `run.ts` 끝** — `scripts/lead50/run.ts` import 에 `import { syncPresets } from '../presets/run.ts'` 추가, 마지막 `await syncPrice(sb, projectId, false)` 뒤에:

```ts
// 새로 만든 레이어에도 필터 버튼 값이 들어가게 (스펙 filter-buttons E6).
await syncPresets(sb, projectId, false)
```

- [ ] **Step 5: 통과 확인** — `node --test tests/lead50.test.ts` → 전부 pass (기존 `priceRows` 테스트 포함). `node --test tests/*.test.ts`, `npm run typecheck`.

- [ ] **Step 6: 커밋**

```bash
git add scripts/lead50/build.ts scripts/lead50/run.ts tests/lead50.test.ts
git commit -m "feat(lead50): 진입가 금액·입주년차 숫자 속성"
```

---

### Task 4: 실데이터 반영

**Files:** 없음 (Supabase 쓰기)

**Interfaces:** Consumes Task 2·3 스크립트.

- [ ] **Step 1: dry-run** — `node scripts/lead50/price.ts 92e81c2e-4607-4449-aa37-3dd8ed38bf46 --dry-run`
  Expected: `source` 3288, `withEntry` ≈ 3208 (거래 없는 80 제외 — HANDOFF), `entryUpdated` 가 3000 이상(모든 원본에 새 키), `perLayer` 가 468/634/444/329/523/810 과 같음, `deleted` 0.
  `withEntry` 에는 거래 없는 단지 중 입주년차만 바뀐 것도 들어간다 — 그 수(≈80)만큼 늘어나는 것은 정상.
- [ ] **Step 2: 실행** — `--dry-run` 없이. 이어서 `node scripts/lead50/top9.ts 92e81c2e-4607-4449-aa37-3dd8ed38bf46` (TOP9 사본에 새 속성 전달).
- [ ] **Step 3: presets** — `node scripts/presets/run.ts 92e81c2e-4607-4449-aa37-3dd8ed38bf46 --dry-run` → `changed` 에 월간선도50 원본 6개·TOP9·진입가 6개·교통 사본 7개 등 해당 필드를 가진 레이어가 나온다. 이어서 실행.
- [ ] **Step 4: 검산** (Supabase 읽기, 스크래치 스크립트를 `scripts/__check.ts` 로 만들고 끝나면 지운다): 원본 3,288 중 `entryPrice` 있는 수(≈3208), `ageYears` 있는 수(3288), `entryPrice` 구간별 수가 진입가 구간 레이어 수와 맞는지(경계값 차이는 따로 셈), 원본 레이어 스키마에 `presets` 가 있는 필드 key 목록.
- [ ] **Step 5: 기록** — 결과 숫자를 ledger 에 남긴다 (커밋 없음).

---

### Task 5: 목록 패널 버튼 묶음 UI

**Files:**
- Modify: `src/ui/FilterBar.tsx` (전체 구성)
- Modify: `src/ui/FeatureList.tsx` (필터 토글 `disabled`)

**Interfaces:**
- Consumes: `presetFields`, `presetOn`, `togglePreset`, `hasManualConds` (Task 1), 실데이터 presets (Task 4)
- Produces: testid `preset-group`(data-key), `preset-button`(aria-pressed), `preset-more`, `manual-toggle`, 기존 `filter-*` 유지

- [ ] **Step 1: `FilterBar.tsx`** — import 를

```ts
import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { uid, type PropertySchemaField } from '../types'
import {
  activeConds, condProblem, fieldFor, filterFields, hasManualConds, opsFor, presetFields, presetOn, togglePreset,
  type FilterCond, type FilterOp,
} from '../filter'
```

로 바꾸고, 파일 머리 주석 끝에 한 줄 추가: `버튼 묶음(E1~E11)은 스키마 presets 로 그린다 — 값은 데이터에만 있다.`

`FilterPanel` 안, `const fieldOf = …` 아래에 추가:

```ts
  const groups = useMemo(() => presetFields(layers), [layers])
  const [more, setMore] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  // 버튼으로 보이지 않는 조건이 있으면 직접 입력을 펼쳐 둔다 — 숨으면 "왜 걸러지지?" 가 된다 (E11).
  const manualForced = useMemo(() => hasManualConds(filters, visibleFields), [filters, visibleFields])
  const showManual = manualOpen || manualForced || groups.length === 0
  const shownGroups = more ? groups : groups.slice(0, 3)
  const btn = embedded ? 'touch-target text-[14px]' : 'h-7 text-[12px]'
```

`return (` 의 바깥 `<div … data-testid="filter-panel">` 바로 안쪽, 기존 `{filters.map(` 앞에 버튼 묶음과 토글을 넣고, 기존 조건 행 `filters.map(...)` 과 `+ 조건 추가` 줄을 `showManual &&` 로 감싼다. 결과 JSX (panel div 안 전체):

```tsx
      {shownGroups.map((f) => (
        <div key={f.key} data-testid="preset-group" data-key={f.key}>
          <div className="text-[12px] font-semibold">{f.label}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {f.presets!.map((p) => {
              const on = presetOn(filters, f.key, p)
              return (
                <button
                  key={p.label}
                  onClick={() => setFilters(togglePreset(filters, f.key, p, uid('flt')))}
                  aria-pressed={on}
                  data-testid="preset-button"
                  className={`${btn} rounded-lg px-2.5 ${on ? 'bg-brand text-white' : 'border border-line bg-surface text-ink'}`}
                >
                  {p.label}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {groups.length > 0 && (
        <div className="flex items-center gap-3">
          {groups.length > 3 && (
            <button
              onClick={() => setMore((v) => !v)}
              className={`${embedded ? 'touch-target' : ''} text-[12px] font-medium text-brand`}
              data-testid="preset-more"
            >
              {more ? '▴ 접기' : `▾ 더보기 (${groups.length - 3})`}
            </button>
          )}
          <button
            onClick={() => setManualOpen((v) => !v)}
            disabled={manualForced}
            className={`${embedded ? 'touch-target' : ''} text-[12px] text-ink-mut disabled:opacity-60`}
            data-testid="manual-toggle"
          >
            직접 입력 {showManual ? '▴' : '›'}
          </button>
        </div>
      )}

      {showManual &&
        filters.map((cond) => {
          /* 기존 조건 행 그대로 (field/inScope/problem/fieldOps/ops … return <div data-testid="filter-row">…</div>) */
        })}

      <div className="flex items-center">
        {showManual && (
          <button
            onClick={add}
            disabled={!visibleFields.length}
            className={`${embedded ? 'touch-target' : ''} text-[12px] font-medium text-brand disabled:text-ink-mut`}
            data-testid="filter-add"
          >
            + 조건 추가
          </button>
        )}
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
```

(주석으로 표시한 `filters.map` 본문은 지금 파일의 조건 행 코드를 한 글자도 바꾸지 않고 옮긴다 — 계획에 다시 적지 않는 이유는 옮기기만 하기 때문이다.)

- [ ] **Step 2: `FeatureList.tsx`** — `filter-toggle` 버튼의 `disabled={!canFilter}` 를 `disabled={!canFilter && !filterOpen}` 로 (E13, 이전 검토 M-3).

- [ ] **Step 3: 정적 확인** — `npm run typecheck`, `node --test tests/*.test.ts`.

- [ ] **Step 4: 브라우저 (dev, 1280×800)** — `npm run dev` 백그라운드, 프로젝트 링크로 연다. 순위 구간 6개만 켠다(원래 표시 상태를 기록해 둔다).
  1. `filter-toggle` → 버튼 묶음 3개(진입가 금액·총세대수·입주년차)와 `▾ 더보기 (5)`. 직접 입력은 접혀 있다.
  2. `1000~` → 개수 1,013 / 3,288 (직접 입력으로 확인했던 값과 같음), 버튼 켜짐.
  3. `2000~` → 총세대수 조건이 하나로 바뀜(직접 입력을 펴서 조건 행 1개 확인), 개수 줄어듦. 켜진 `2000~` 다시 → 해제, 3,288.
  4. 더보기 → 8묶음. `역까지 800m` + `총세대수 1000~` → 570 (앞 작업 값과 같음).
  5. 직접 입력에서 총세대수 `1200` 입력 → 직접 입력이 강제로 펼쳐지고 `manual-toggle` 비활성, 총세대수 버튼은 모두 꺼짐.
  6. `입주년차 ~10년`, `진입가 금액 5억 이하` 각각 개수를 스토어 직접 계산과 대조.
  스크린샷 `docs/screenshots/filter-06-buttons.png`.
- [ ] **Step 5: 브라우저 (390×844)** — 목록 시트 → 필터 → 버튼 높이 44px, `1000~` 누르고 시트를 끌어 접힘(88px)으로 → 지도가 크게 보이고 헤더 개수 유지. 스크린샷 `filter-07-mobile-buttons.png`, `filter-08-mobile-collapsed.png`.
- [ ] **Step 6: 커밋**

```bash
git add src/ui/FilterBar.tsx src/ui/FeatureList.tsx docs/screenshots/filter-06-buttons.png docs/screenshots/filter-07-mobile-buttons.png docs/screenshots/filter-08-mobile-collapsed.png
git commit -m "feat(filter): 목록 패널에 항목별 버튼 묶음"
```

---

### Task 6: PC 우측 패널 접기

**Files:**
- Modify: `src/App.tsx` (상태·이펙트, PC 분기의 지도 컨테이너·우측 aside)

**Interfaces:** Consumes `filterOn`(App 에 이미 있음), `selectedId`.

- [ ] **Step 1: 구현** — `const [layersOpen, setLayersOpen] = useState(true)` 아래에:

```ts
  const [listOpen, setListOpen] = useState(true)
```

선택 → 정보 페이지 이펙트 아래에:

```ts
  // PC 우측 패널을 접은 채 도형을 고르면 정보 페이지가 안 보인다 — 선택이 생기면 편다 (스펙 filter-buttons E12).
  useEffect(() => {
    if (selectedId) setListOpen(true)
  }, [selectedId])
```

PC 분기 지도 컨테이너 안, `toggle-layer-panel` 버튼 뒤에:

```tsx
          <button
            onClick={() => setListOpen((v) => !v)}
            className="absolute right-12 top-2 z-10 rounded-lg border border-line bg-surface/95 px-2 py-1.5 text-[12px] shadow-md backdrop-blur"
            data-testid="toggle-list-panel"
          >
            {listOpen ? '패널 ▶' : '◀ 목록'}
            {!listOpen && filterOn && (
              <span
                className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-brand align-middle"
                data-testid="list-panel-filter-dot"
                aria-label="필터 적용 중"
              />
            )}
          </button>
```

우측 aside 의 `className="w-[360px] flex-none border-l border-line bg-surface"` 를:

```tsx
          className={`flex-none border-l border-line bg-surface transition-[width] duration-200 ${
            listOpen ? 'w-[360px]' : 'w-0 overflow-hidden border-l-0'
          }`}
```

- [ ] **Step 2: 정적 확인** — `npm run typecheck`.
- [ ] **Step 3: 브라우저 (1280×800)**
  1. `패널 ▶` → 우측 패널 폭 0, 지도가 넓어짐. 지도 캔버스 폭(`.maplibregl-canvas` 의 `getBoundingClientRect().width`)이 전환 뒤 늘었는지 — 늘지 않으면(검은 띠·늘어진 타일) MapLibre 가 컨테이너를 못 따라간 것 → `map.resize()` 를 `transitionend` 에 부르는 수정을 Ruling 으로 추가.
  2. 필터 버튼 하나 켠 상태로 접으면 `list-panel-filter-dot` 보임.
  3. 접힌 상태에서 지도의 단지 점 클릭 → 패널이 펴지고 정보 페이지가 보인다 (Review Focus 5). 점 좌표는 패널 폭이 바뀐 뒤 다시 잰다(CLAUDE.md 함정).
  4. 콘솔 오류 없음.
  스크린샷 `docs/screenshots/filter-09-panel-collapsed.png`.
- [ ] **Step 4: 커밋**

```bash
git add src/App.tsx docs/screenshots/filter-09-panel-collapsed.png
git commit -m "feat(app): PC 우측 패널 접기"
```

---

### Task 7: 문서와 원복

**Files:** `CLAUDE.md`, `docs/HANDOFF.md`, `docs/log/2026-09-30.md`

- [ ] **Step 1: 원복** — 브라우저 확인에서 바꾼 레이어 표시를 원래대로(관광지·진입가 3~5억만 보임), 새로고침으로 서버 반영 확인.
- [ ] **Step 2: `CLAUDE.md`** — 명령 블록의 `price.ts` 줄 아래에:

```
node scripts/presets/run.ts <projectId> [--dry-run]   # 필터 버튼 값을 모든 레이어 스키마에 (lead50 run.ts 가 끝에서 부른다, transit 뒤에는 수동). 실행 뒤 앱 탭은 새로고침
```

"알려진 불일치·미해결" 의 필터 문단(`**필터(F-71 일부)는 있다**` 로 시작하는 줄) 끝에 한 줄:

```
  버튼 묶음은 스키마 필드 `presets`(스크립트 소유, `scripts/presets/presets.ts`)로 그린다 — 앱은 편집하지 않는다. 스펙 `2026-09-30-filter-buttons-design.md`.
```

- [ ] **Step 3: `HANDOFF.md`** — "목록 필터 (2026-09-30)" 문단 뒤에:

```
**필터 버튼 (2026-09-30)** — 아실식 항목별 버튼(진입가 금액·총세대수·입주년차·평당시세·역까지·선릉/여의도/시청). 값은 `scripts/presets/presets.ts`,
스키마 `presets` 로 들어간다. 원본 단지에 `entryPrice`(억)·`ageYears`(년차) 숫자 속성 추가(`price.ts`). PC 우측 패널 접기.
스크립트로 스키마를 바꾼 뒤에는 앱 탭을 새로고침한다. 설계 `docs/superpowers/specs/2026-09-30-filter-buttons-design.md`.
```

- [ ] **Step 4: `docs/log/2026-09-30.md`** — "## 필터 버튼" 절 추가: 참고 사이트 실측 요약, 사용자 결정(B·우측 패널 접기·presets·추천 진행), 실데이터 결과(Task 4 숫자), 브라우저 확인 결과, 계획과 달라진 것.
- [ ] **Step 5: 최종 확인과 커밋** — `node --test tests/*.test.ts`, `npm run typecheck`, `npm run build`.

```bash
git add CLAUDE.md docs/HANDOFF.md docs/log/2026-09-30.md
git commit -m "docs: 필터 버튼 기록"
```
