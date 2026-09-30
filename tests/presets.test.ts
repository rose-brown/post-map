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
