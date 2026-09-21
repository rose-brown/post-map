import Dexie, { type EntityTable } from 'dexie'
import type { Feature, Layer, Project, StoredBlob } from '../types'
import { SCHEMA_VERSION } from '../types'
import { MIGRATIONS } from './migrations'

/**
 * Phase 1~2 는 브라우저(IndexedDB)만 쓴다. Phase 3 부터 Supabase + PostGIS.
 * 그 이관을 위해 지금부터 스키마 버전과 마이그레이션 함수 자리를 둔다 (PRD 4.4).
 *
 * 스토어 구성은 PRD 4.4 표를 그대로 따른다:
 *   projects / layers(index projectId) / features(index layerId, parentId) / blobs(index featureId) / meta
 */
export class MapDb extends Dexie {
  projects!: EntityTable<Project, 'id'>
  layers!: EntityTable<Layer, 'id'>
  features!: EntityTable<Feature, 'id'>
  blobs!: EntityTable<StoredBlob, 'id'>
  meta!: EntityTable<{ key: string; value: unknown }, 'key'>

  constructor() {
    super('map-editor')

    this.version(1).stores({
      projects: 'id, updatedAt',
      layers: 'id, projectId, order',
      features: 'id, layerId, parentId, updatedAt',
      blobs: 'id, featureId',
      meta: 'key',
    })

    // 버전을 올릴 때 여기에 `this.version(n).stores({...}).upgrade(...)` 를 잇는다.
    // 데이터 변환은 MIGRATIONS 에 순차 함수로 둔다.
  }
}

export const db = new MapDb()

/**
 * meta.schemaVersion 을 읽어 필요한 마이그레이션을 순서대로 적용한다.
 * Phase 3 이관은 복사이지 이동이 아니므로(F-81), 여기서 로컬 데이터를 지우지 않는다.
 */
export async function runMigrations(): Promise<number> {
  const row = await db.meta.get('schemaVersion')
  let current = typeof row?.value === 'number' ? row.value : 0

  if (current === 0) {
    await db.meta.put({ key: 'schemaVersion', value: SCHEMA_VERSION })
    return SCHEMA_VERSION
  }

  while (current < SCHEMA_VERSION) {
    const step = MIGRATIONS[current]
    if (!step) break
    await step(db)
    current += 1
    await db.meta.put({ key: 'schemaVersion', value: current })
  }

  return current
}
