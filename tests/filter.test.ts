import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activeConds, activeFilter, condProblem, fieldFor, filterFields, hasManualConds, matches, opsFor, presetFields, presetOn, shownPresetGroups, togglePreset, type FilterCond } from '../src/filter.ts'
import type { Feature, FilterPreset, Layer, PropertySchemaField } from '../src/types.ts'

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

test('fieldFor: 보이는 필드 정의가 먼저, 없으면 전체 레이어 정의', () => {
  const visible = [num('h', '보이는 h')]
  const all = [txt('h', '숨은 h'), num('h', '보이는 h'), num('s', '숨은 s')]
  assert.equal(fieldFor('h', visible, all)?.type, 'number')
  assert.equal(fieldFor('s', visible, all)?.label, '숨은 s')
  assert.equal(fieldFor('gone', visible, all), undefined)
})

test('condProblem: 필드가 안 보이면 out-of-scope, 연산자가 타입과 안 맞으면 op-mismatch, 아니면 null', () => {
  const visible = [txt('h'), num('s')]
  assert.equal(condProblem(c('x', 'gte', '1'), visible), 'out-of-scope')
  assert.equal(condProblem(c('h', 'gte', '1'), visible), 'op-mismatch')
  assert.equal(condProblem(c('s', 'gte', ''), visible), null) // 빈 값은 입력 중 — 표시할 문제 아님
  assert.equal(condProblem(c('s', 'lte', '1'), visible), null)
})

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

test('shownPresetGroups: 처음 3개 + 조건이 걸린 묶음은 접어도 보인다', () => {
  const g = ['a', 'b', 'c', 'd', 'e'].map((k) => withP(num(k), [pre('1', 'gte', '1')]))
  assert.deepEqual(shownPresetGroups(g, [], false).map((f) => f.key), ['a', 'b', 'c'])
  assert.deepEqual(shownPresetGroups(g, [c('e', 'gte', '1')], false).map((f) => f.key), ['a', 'b', 'c', 'e'])
  assert.deepEqual(shownPresetGroups(g, [], true).map((f) => f.key), ['a', 'b', 'c', 'd', 'e'])
})

const pc = (key: string, op: FilterCond['op'], value: FilterCond['value']): FilterCond => ({ ...c(key, op, value), id: `${key}${op}${value}`, preset: true })

test('matches: 같은 key 의 버튼 조건은 OR, 다른 key·직접 입력은 AND', () => {
  const r35 = pc('e', 'between', ['3', '4.99']), r565 = pc('e', 'between', ['5', '6.49'])
  assert.equal(matches(feat({ e: 4 }), [r35, r565]), true)
  assert.equal(matches(feat({ e: 6 }), [r35, r565]), true)
  assert.equal(matches(feat({ e: 7 }), [r35, r565]), false)
  const h = pc('h', 'between', ['1000', '1999'])
  assert.equal(matches(feat({ e: 6, h: 1500 }), [r35, r565, h]), true)
  assert.equal(matches(feat({ e: 6, h: 2500 }), [r35, r565, h]), false)
  // 직접 입력 두 개는 AND (범위)
  assert.equal(matches(feat({ h: 1500 }), [c('h', 'gte', '1000'), c('h', 'lte', '1200')]), false)
})

test('togglePreset: 같은 key 에서 여러 버튼을 켜고 하나씩 끈다', () => {
  const a = pre('3~5억', 'between', ['3', '4.99']), b = pre('5~6.5억', 'between', ['5', '6.49'])
  let conds = togglePreset([], 'e', a, 'id1')
  conds = togglePreset(conds, 'e', b, 'id2')
  assert.deepEqual(conds.map((x) => [x.id, x.preset]), [['id1', true], ['id2', true]])
  assert.equal(presetOn(conds, 'e', a) && presetOn(conds, 'e', b), true)
  conds = togglePreset(conds, 'e', a, 'id3')
  assert.deepEqual(conds.map((x) => x.id), ['id2'])
})

test('togglePreset: 버튼을 켜면 같은 key 의 직접 입력 조건만 지운다', () => {
  const conds = [c('e', 'gte', '2'), pc('e', 'between', ['3', '4.99']), c('s', 'lte', '800')]
  const next = togglePreset(conds, 'e', pre('5~6.5억', 'between', ['5', '6.49']), 'n')
  assert.deepEqual(next.map((x) => [x.key, x.op, x.preset ?? false]), [['e', 'between', true], ['s', 'lte', false], ['e', 'between', true]])
})
