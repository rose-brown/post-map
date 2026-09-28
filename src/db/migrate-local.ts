import { db, runMigrations } from './db'
import { createProject, flush, putBlob, saveFeatures, saveLayer } from './repo'
import { userInput } from '../persist/persistable'
import { nowIso } from '../types'
import { newLayer } from '../store/useStore'
import type { Layer, Project } from '../types'

/**
 * IndexedDB → 서버 복사 (F-81). **복사다. 로컬을 지우지 않는다.**
 *
 * 이관이 실패하면 부분 복사가 남는다. 그때 projects 행 하나만 지우면
 * FK on delete cascade 가 layers·features·blobs 를 정리한다 (스펙 4.5).
 */

export async function countLocal(): Promise<{ layers: number; features: number; blobs: number }> {
  await runMigrations()
  const [layers, features, blobs] = await Promise.all([
    db.layers.count(),
    db.features.count(),
    db.blobs.count(),
  ])
  return { layers, features, blobs }
}

export async function migrateLocalToServer(): Promise<string> {
  await runMigrations()

  const locals = await db.projects.toArray()
  const local = locals.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
  if (!local) throw new Error('이 기기에 복사할 기록이 없습니다.')

  const layers = (await db.layers.where('projectId').equals(local.id).toArray())
    .sort((a, b) => a.order - b.order)
  const layerIds = new Set(layers.map((l) => l.id))
  const features = (await db.features.toArray()).filter((f) => layerIds.has(f.layerId))

  // 1) 프로젝트 + 첫 레이어. id 는 createProject 가 만들므로 빈 문자열로 보낸다.
  const draft: Project = { ...local, id: '', updatedAt: nowIso() }
  const first: Layer = layers[0] ?? newLayer('', 0, '기본 레이어')
  const projectId = await createProject(userInput(draft), userInput({ ...first, projectId: '' }))

  // 2) 나머지 레이어 → 3) 피처. FK 순서다.
  if (layers.length > 1) {
    layers.slice(1).forEach((l) => saveLayer(userInput({ ...l, projectId })))
    await flush()
  }
  if (features.length) {
    saveFeatures(features.map((f) => userInput(f)))
    await flush()
  }

  // 4) 이미지. 피처가 먼저 있어야 blobs.feature_id FK 가 통과한다.
  const blobs = await db.blobs.toArray()
  for (const b of blobs) {
    if (!features.some((f) => f.id === b.featureId)) continue  // 고아 blob 은 옮기지 않는다
    await putBlob(b)
  }

  // 5) 재안내 방지. 로컬 데이터는 그대로 남긴다 (F-81).
  await db.meta.put({ key: 'migratedProjectId', value: projectId })
  return projectId
}
