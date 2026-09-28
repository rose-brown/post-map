import type {
  Block, Feature, Layer, LayerStyle, Project, Properties, PropertySchemaField,
} from '../types'
import type { Geometry } from 'geojson'

/**
 * 도메인 타입 ↔ DB 행 변환. 순수 함수만 둔다 — I/O 도, 런타임 import 도 없다.
 * tests/mappers.test.ts 가 Node 내장 test runner 로 이 파일을 직접 돌리므로
 * (타입 제거 실행) 런타임 import 를 들이면 깨진다. `import type` 만 쓴다.
 *
 * 중첩 객체(style·initialView·schema·derivedFrom)는 쪼개지 않고 jsonb 로 둔다 —
 * 서버가 그 안을 질의하지 않는다 (스펙 D6).
 *
 * "값이 없으면 키를 저장하지 않는다"(PRD 4.3)는 properties 안에서만 적용된다.
 * 컬럼 수준에서는 Postgres 가 null 을 요구하므로 null ↔ undefined 를 여기서 변환한다.
 */

export interface ProjectRow {
  id: string
  name: string
  description: string
  initial_view: Project['initialView']
  schema_version: number
  created_at: string
  updated_at: string
}

export interface LayerRow {
  id: string
  project_id: string
  name: string
  kind: Layer['kind']
  visible: boolean
  order: number
  style: LayerStyle
  schema: PropertySchemaField[]
  locked: boolean
}

export interface FeatureRow {
  id: string
  project_id: string
  layer_id: string
  parent_id: string | null
  geometry: Geometry
  title: string
  properties: Properties
  blocks: Block[]
  derived_from: Feature['derivedFrom'] | null
  created_at: string
  updated_at: string
}

export const projectToRow = (p: Project): ProjectRow => ({
  id: p.id,
  name: p.name,
  description: p.description,
  initial_view: p.initialView,
  schema_version: p.schemaVersion,
  created_at: p.createdAt,
  updated_at: p.updatedAt,
})

export const rowToProject = (r: ProjectRow): Project => ({
  id: r.id,
  name: r.name,
  description: r.description,
  initialView: r.initial_view,
  schemaVersion: r.schema_version,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

export const layerToRow = (l: Layer, projectId: string): LayerRow => ({
  id: l.id,
  project_id: projectId,
  name: l.name,
  kind: l.kind,
  visible: l.visible,
  order: l.order,
  style: l.style,
  schema: l.schema,
  locked: l.locked,
})

export const rowToLayer = (r: LayerRow): Layer => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  kind: r.kind,
  visible: r.visible,
  order: r.order,
  style: r.style,
  schema: r.schema,
  locked: r.locked,
})

export const featureToRow = (f: Feature, projectId: string): FeatureRow => ({
  id: f.id,
  project_id: projectId,
  layer_id: f.layerId,
  parent_id: f.parentId ?? null,
  geometry: f.geometry,
  title: f.title,
  properties: f.properties,
  blocks: f.blocks,
  derived_from: f.derivedFrom ?? null,
  created_at: f.createdAt,
  updated_at: f.updatedAt,
})

/** derivedFrom 이 없으면 키를 아예 넣지 않는다 — deepEqual 이 undefined 키를 다르게 본다. */
export const rowToFeature = (r: FeatureRow): Feature => {
  const f: Feature = {
    id: r.id,
    layerId: r.layer_id,
    geometry: r.geometry,
    title: r.title,
    properties: r.properties,
    blocks: r.blocks,
    parentId: r.parent_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
  if (r.derived_from) f.derivedFrom = r.derived_from
  return f
}
