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
