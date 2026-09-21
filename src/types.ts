/** 도메인 모델. PRD 4.2 필드 정의를 그대로 따른다. */
import type { Geometry } from 'geojson'

/** 현재 IndexedDB 스키마 버전. 올릴 때 src/db/migrations.ts 에 업그레이드 함수를 추가한다. */
export const SCHEMA_VERSION = 1

export type PropertyType =
  | 'text'
  | 'number'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'boolean'
  | 'url'
  | 'phone'

/** `key` 는 레이어 내 유일. */
export interface PropertySchemaField {
  key: string
  label: string
  type: PropertyType
  unit?: string
  required?: boolean
  options?: string[]
}

export type PropertyValue = string | number | boolean | string[]

/**
 * 스키마 필드와 스키마 밖 자유 필드를 둘 다 허용한다.
 * 값이 없으면 키를 저장하지 않는다 (PRD 4.3) — null 을 넣지 않는다.
 */
export type Properties = Record<string, PropertyValue>

/**
 * `properties` 에 들어가지만 사용자 속성 목록에는 보여주지 않는 내부 키.
 * 값 자체는 GeoJSON 으로 내보낼 때 같이 나간다.
 *   radius / label — 동심원 링이 쓴다
 *   icon           — 포인트 표시 아이콘 (src/map/markers.ts)
 */
export const RESERVED_PROPERTY_KEYS = new Set(['radius', 'label', 'icon'])

export type BlockType =
  | 'text'
  | 'heading'
  | 'todo'
  | 'gallery'
  | 'files'
  | 'callout'
  | 'divider'

export interface TodoItem {
  id: string
  text: string
  done: boolean
}

/** gallery·files 블록이 참조하는 Blob 키. 실제 바이트는 blobs 스토어에 있다. */
export interface BlobRef {
  id: string
  name: string
  /** 바이트 수. 표시용 포맷은 UI 에서 한다. */
  size: number
  mime: string
}

export interface Block {
  id: string
  type: BlockType
  /** text | heading | callout */
  text?: string
  /** todo */
  items?: TodoItem[]
  /** gallery | files */
  refs?: BlobRef[]
}

export interface Feature {
  id: string
  layerId: string
  geometry: Geometry
  title: string
  properties: Properties
  blocks: Block[]
  derivedFrom?: {
    op: 'ring'
    sourceIds: string[]
    params: Record<string, unknown>
  }
  /** 동심원 링 → 중심 point. 부모 삭제 시 cascade. */
  parentId?: string | null
  createdAt: string
  updatedAt: string
}

export interface LayerStyle {
  color: string
  opacity: number
  strokeWidth: number
  pointRadius: number
}

export interface Layer {
  id: string
  projectId: string
  name: string
  /** Phase 1 은 vector 만 만든다. 나머지 값은 Phase 2 이후. */
  kind: 'vector' | 'file' | 'tile' | 'api'
  visible: boolean
  order: number
  style: LayerStyle
  schema: PropertySchemaField[]
  locked: boolean
}

export interface Project {
  id: string
  name: string
  description: string
  initialView: { lng: number; lat: number; zoom: number; bearing: number; pitch: number }
  schemaVersion: number
  createdAt: string
  updatedAt: string
}

export interface StoredBlob {
  id: string
  featureId: string
  blob: Blob
}

/** 동심원 반경 기본값 (m). PRD F-20. */
export const DEFAULT_RADII = [500, 1000, 2000]

export const uid = (prefix: string): string =>
  `${prefix}_${crypto.randomUUID().slice(0, 12)}`

export const nowIso = (): string => new Date().toISOString()
