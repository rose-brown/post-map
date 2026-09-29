import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pointSizeRatios, dotRadius, pinScale } from '../src/map/pointSize.ts'
import type { Feature, Layer } from '../src/types.ts'

const layer = (id: string, sizeField?: string): Layer => ({
  id, name: id, kind: 'vector', visible: true, order: 0, schema: [], locked: false,
  style: { color: '#000', opacity: 1, strokeWidth: 1, pointRadius: 6, ...(sizeField ? { sizeField } : {}) },
})
const pt = (id: string, layerId: string, n?: unknown): Feature => ({
  id, layerId, title: id, blocks: [], createdAt: '', updatedAt: '',
  geometry: { type: 'Point', coordinates: [0, 0] },
  properties: n === undefined ? {} : { n: n as number },
})

test('pointSizeRatios: 같은 필드를 쓰는 레이어 전체의 최소~최대를 로그로 0~1', () => {
  const r = pointSizeRatios(
    [pt('a', 'A', 100), pt('b', 'B', 1000), pt('c', 'A', 10), pt('d', 'A'), pt('e', 'A', '가'), pt('f', 'A', 0), pt('g', 'N', 99999)],
    [layer('A', 'n'), layer('B', 'n'), layer('N')],
  )
  assert.equal(r.get('b'), 1)
  assert.equal(r.get('c'), 0)
  assert.ok(Math.abs(r.get('a')! - 0.5) < 1e-12)
  assert.equal(r.has('d'), false) // 값 없음
  assert.equal(r.has('e'), false) // 숫자 아님
  assert.equal(r.has('f'), false) // 0
  assert.equal(r.has('g'), false) // sizeField 없는 레이어
})

test('pointSizeRatios: 값이 모두 같으면 1', () => {
  const r = pointSizeRatios([pt('a', 'A', 5), pt('b', 'A', 5)], [layer('A', 'n')])
  assert.deepEqual([...r.values()], [1, 1])
})

test('pointSizeRatios: 링·선은 대상이 아니다', () => {
  const ring = { ...pt('r', 'A', 100), derivedFrom: { op: 'ring' as const, sourceIds: ['a'], params: {} } }
  const line = { ...pt('l', 'A', 100), geometry: { type: 'LineString' as const, coordinates: [[0, 0], [1, 1]] } }
  assert.equal(pointSizeRatios([ring, line], [layer('A', 'n')]).size, 0)
})

test('dotRadius · pinScale: 값이 없으면 기본 크기, 있으면 바닥이 있다', () => {
  assert.equal(dotRadius(undefined), 6)
  assert.equal(dotRadius(undefined, 3), 3)   // 레이어 style.pointRadius
  assert.equal(dotRadius(1, 3), 14)          // sizeField 비율이 있으면 레이어 반지름은 무시
  assert.equal(dotRadius(1), 14)
  assert.equal(dotRadius(0), 3)
  assert.equal(pinScale(undefined), 1)
  assert.equal(pinScale(1), 1.5)
  assert.equal(pinScale(0), 0.7)
})
