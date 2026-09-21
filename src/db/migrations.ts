import type { MapDb } from './db'

/**
 * 버전 n → n+1 로 올리는 데이터 변환 함수를 `MIGRATIONS[n]` 에 둔다.
 * Phase 1 은 최초 버전이라 적용할 변환이 아직 없다. 버전을 올릴 때 이 표에 항목을 추가하면
 * runMigrations() 가 순서대로 실행한다.
 *
 * 예) 버전 1 → 2 에서 Feature.title 을 properties.name 으로 옮긴다면:
 *   1: async (db) => { await db.features.toCollection().modify(f => { ... }) }
 */
export const MIGRATIONS: Record<number, (db: MapDb) => Promise<void>> = {}
