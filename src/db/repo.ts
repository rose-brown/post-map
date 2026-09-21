import { db } from './db'
import type { Feature, Layer, Project, StoredBlob } from '../types'
import type { Persistable } from '../persist/persistable'

/**
 * 쓰기는 500ms 디바운스 배치. 매 키 입력마다 트랜잭션을 열지 않는다.
 *
 * 저장 함수는 `Persistable<T>` 만 받는다 — 불변 규칙 1. 제공자 응답을 그대로 넣으려면
 * `fromProvider()` 를 통과해야 하고, 그 제공자는 `canPersistResults: true` 여야 한다.
 */

type Pending = {
  features: Map<string, Feature>
  layers: Map<string, Layer>
  projects: Map<string, Project>
  deletedFeatures: Set<string>
  deletedLayers: Set<string>
}

const pending: Pending = {
  features: new Map(),
  layers: new Map(),
  projects: new Map(),
  deletedFeatures: new Set(),
  deletedLayers: new Set(),
}

let timer: ReturnType<typeof setTimeout> | null = null
let inFlight: Promise<void> = Promise.resolve()

type SaveState = 'idle' | 'pending' | 'saved' | 'error'
const listeners = new Set<(s: SaveState) => void>()
let saveState: SaveState = 'idle'

export function onSaveState(fn: (s: SaveState) => void): () => void {
  listeners.add(fn)
  fn(saveState)
  return () => listeners.delete(fn)
}

function setSaveState(s: SaveState) {
  saveState = s
  listeners.forEach((fn) => fn(s))
}

function schedule() {
  setSaveState('pending')
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    inFlight = flush()
  }, 500)
}

export async function flush(): Promise<void> {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }

  const features = [...pending.features.values()]
  const layers = [...pending.layers.values()]
  const projects = [...pending.projects.values()]
  const delFeatures = [...pending.deletedFeatures]
  const delLayers = [...pending.deletedLayers]

  if (
    !features.length && !layers.length && !projects.length &&
    !delFeatures.length && !delLayers.length
  ) {
    return
  }

  pending.features.clear()
  pending.layers.clear()
  pending.projects.clear()
  pending.deletedFeatures.clear()
  pending.deletedLayers.clear()

  try {
    await db.transaction('rw', db.projects, db.layers, db.features, db.blobs, async () => {
      if (delFeatures.length) {
        await db.features.bulkDelete(delFeatures)
        await db.blobs.where('featureId').anyOf(delFeatures).delete()
      }
      if (delLayers.length) {
        const orphan = await db.features.where('layerId').anyOf(delLayers).primaryKeys()
        await db.features.bulkDelete(orphan)
        await db.blobs.where('featureId').anyOf(orphan).delete()
        await db.layers.bulkDelete(delLayers)
      }
      if (projects.length) await db.projects.bulkPut(projects)
      if (layers.length) await db.layers.bulkPut(layers)
      if (features.length) await db.features.bulkPut(features)
    })
    setSaveState('saved')
  } catch (err) {
    console.error('[repo] 저장 실패', err)
    setSaveState('error')
  }
}

export function saveProject(p: Persistable<Project>): void {
  pending.projects.set(p.id, p)
  schedule()
}

export function saveLayer(l: Persistable<Layer>): void {
  pending.layers.set(l.id, l)
  schedule()
}

export function saveFeature(f: Persistable<Feature>): void {
  pending.features.set(f.id, f)
  pending.deletedFeatures.delete(f.id)
  schedule()
}

export function saveFeatures(fs: Persistable<Feature>[]): void {
  fs.forEach((f) => {
    pending.features.set(f.id, f)
    pending.deletedFeatures.delete(f.id)
  })
  schedule()
}

export function deleteFeatures(ids: string[]): void {
  ids.forEach((id) => {
    pending.deletedFeatures.add(id)
    pending.features.delete(id)
  })
  schedule()
}

export function deleteLayer(id: string): void {
  pending.deletedLayers.add(id)
  pending.layers.delete(id)
  schedule()
}

export async function putBlob(rec: StoredBlob): Promise<void> {
  await db.blobs.put(rec)
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  const row = await db.blobs.get(id)
  return row?.blob
}

export async function deleteBlob(id: string): Promise<void> {
  await db.blobs.delete(id)
}

export async function loadAll(projectId: string): Promise<{
  project: Project | undefined
  layers: Layer[]
  features: Feature[]
}> {
  await inFlight
  const [project, layers, features] = await Promise.all([
    db.projects.get(projectId),
    db.layers.where('projectId').equals(projectId).toArray(),
    db.features.toArray(),
  ])
  const layerIds = new Set(layers.map((l) => l.id))
  return {
    project,
    layers: layers.sort((a, b) => a.order - b.order),
    features: features.filter((f) => layerIds.has(f.layerId)),
  }
}

export async function firstProjectId(): Promise<string | undefined> {
  // 생성 순서로 결정한다. toArray() 의 반환 순서에 기대면 실행마다 다른 프로젝트를 열 수 있다.
  const all = await db.projects.toArray()
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]?.id
}
