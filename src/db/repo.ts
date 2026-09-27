import type { Feature, Layer, Project, StoredBlob } from '../types'
import type { Persistable } from '../persist/persistable'
import type { SupabaseClient } from '@supabase/supabase-js'
import { makeAnonClient, makeClient, publicBlobUrl } from './supabase'
import {
  featureToRow, layerToRow, projectToRow, rowToFeature, rowToLayer, rowToProject,
  type FeatureRow, type LayerRow, type ProjectRow,
} from './mappers'

/**
 * 쓰기는 500ms 디바운스 배치. 매 키 입력마다 요청을 보내지 않는다.
 *
 * 저장 함수는 `Persistable<T>` 만 받는다 — 불변 규칙 1. 제공자 응답을 그대로 넣으려면
 * `fromProvider()` 를 통과해야 하고, 그 제공자는 `canPersistResults: true` 여야 한다.
 * `Persistable<T>` 는 `T` 에 브랜드를 더한 타입이라 구조적으로 이미 `T` 다 — 꺼낼 필요가 없다.
 *
 * Phase 3 부터 진실의 원천은 서버(Supabase)다. IndexedDB 는 읽기 경로에서 빠지고
 * 이관 원본으로만 남는다 (F-81). setActiveProject() 가 먼저 불려야 한다.
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

let sb: SupabaseClient | null = null
let activeProjectId: string | null = null

/** 프로젝트가 정해진 뒤 한 번 부른다. 이후 모든 요청에 x-project-id 헤더가 붙는다. */
export function setActiveProject(projectId: string): void {
  activeProjectId = projectId
  sb = makeClient(projectId)
}

function client(): SupabaseClient {
  if (!sb) throw new Error('setActiveProject() 가 먼저 불려야 합니다.')
  return sb
}

function projectId(): string {
  if (!activeProjectId) throw new Error('setActiveProject() 가 먼저 불려야 합니다.')
  return activeProjectId
}

type SaveState = 'idle' | 'pending' | 'saved' | 'error'
const listeners = new Set<(s: SaveState) => void>()
let saveState: SaveState = 'idle'
let lastError: string | null = null

export function onSaveState(fn: (s: SaveState) => void): () => void {
  listeners.add(fn)
  fn(saveState)
  return () => listeners.delete(fn)
}

/** 마지막 저장 실패 메시지. onSaveState 의 시그니처를 바꾸지 않기 위해 따로 둔다. */
export function lastSaveError(): string | null {
  return lastError
}

/** 아직 서버로 못 보낸 변경이 있는지. beforeunload 경고가 이것을 본다. */
export function hasUnsaved(): boolean {
  return (
    pending.features.size > 0 || pending.layers.size > 0 || pending.projects.size > 0 ||
    pending.deletedFeatures.size > 0 || pending.deletedLayers.size > 0
  )
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

let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryDelay = 1000

/**
 * 실패한 큐를 다시 보낸다. 성공하면 간격을 되돌린다.
 * flush() 는 던지지 않는다 — inFlight 가 거부되면 loadAll() 의 await 가 깨진다.
 */
export async function retryFlush(): Promise<void> {
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  await flush()
  if (saveState === 'error') {
    retryDelay = Math.min(retryDelay * 2, 30_000)
    retryTimer = setTimeout(() => void retryFlush(), retryDelay)
  } else {
    retryDelay = 1000
  }
}

/**
 * 큐를 서버로 보낸다. **실패 시 큐를 비우지 않는다** — 비우면 조용히 사라진다.
 * 성공한 테이블만 비우므로 재시도가 남은 것만 다시 보낸다.
 *
 * 순서는 FK 때문에 고정이다: upsert(projects → layers → features) → delete(features → layers).
 * upsert 를 먼저 하는 이유는, 지워질 레이어에 속한 피처를 upsert 하면 FK 가 걸리기 때문이다.
 * 레이어 삭제는 Postgres 의 on delete cascade 가 자식 피처를 정리한다.
 */
export async function flush(): Promise<void> {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!hasUnsaved()) return

  const pid = projectId()
  const c = client()
  setSaveState('pending')

  try {
    if (pending.projects.size) {
      const rows = [...pending.projects.values()].map(projectToRow)
      const { error } = await c.from('projects').upsert(rows)
      if (error) throw error
      pending.projects.clear()
    }
    if (pending.layers.size) {
      const rows = [...pending.layers.values()].map((l) => layerToRow(l, pid))
      const { error } = await c.from('layers').upsert(rows)
      if (error) throw error
      pending.layers.clear()
    }
    if (pending.features.size) {
      const rows = [...pending.features.values()].map((f) => featureToRow(f, pid))
      const { error } = await c.from('features').upsert(rows)
      if (error) throw error
      pending.features.clear()
    }
    if (pending.deletedFeatures.size) {
      const ids = [...pending.deletedFeatures]
      await purgeBlobsOfFeatures(ids)
      const { error } = await c.from('features').delete().in('id', ids)
      if (error) throw error
      pending.deletedFeatures.clear()
    }
    if (pending.deletedLayers.size) {
      const ids = [...pending.deletedLayers]
      const orphans = await featureIdsOfLayers(ids)
      await purgeBlobsOfFeatures(orphans)
      const { error } = await c.from('layers').delete().in('id', ids)
      if (error) throw error
      pending.deletedLayers.clear()
    }
    lastError = null
    setSaveState('saved')
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err)
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

/**
 * 새 프로젝트와 기본 레이어를 만들고 uuid 를 돌려준다.
 * id 는 서버가 gen_random_uuid() 로 만든다 — 클라이언트 값을 보내지 않는다.
 * 이 INSERT 만 헤더 없는 클라이언트로 한다 (그 시점에는 uuid 를 모른다).
 */
export async function createProject(
  p: Persistable<Project>,
  firstLayer: Persistable<Layer>,
): Promise<string> {
  const { id: _ignored, ...insert } = projectToRow(p)
  const { data, error } = await makeAnonClient()
    .from('projects').insert(insert).select('id').single()
  if (error) throw error
  const newId = (data as { id: string }).id
  setActiveProject(newId)
  const { error: le } = await client().from('layers').insert(layerToRow(firstLayer, newId))
  if (le) throw le
  return newId
}

/** 파일당 상한. Storage 업로드를 프로젝트 단위로 막을 수 없어 악용을 완화한다 (스펙 3절). */
export const MAX_BLOB_BYTES = 10 * 1024 * 1024

export async function putBlob(rec: StoredBlob): Promise<void> {
  if (rec.blob.size > MAX_BLOB_BYTES) {
    throw new Error(`파일이 너무 큽니다 (최대 ${MAX_BLOB_BYTES / 1024 / 1024}MB)`)
  }
  const pid = projectId()
  const path = `${pid}/${rec.id}`
  const mime = rec.blob.type || 'application/octet-stream'
  // 순서가 중요하다: 업로드 먼저, 메타 행 나중. 반대면 경로 없는 행이 남는다.
  const up = await client().storage.from('blobs').upload(path, rec.blob, {
    contentType: mime,
    upsert: false,
  })
  if (up.error) throw up.error
  const { error } = await client().from('blobs').insert({
    id: rec.id,
    project_id: pid,
    feature_id: rec.featureId,
    path,
    mime,
    size: rec.blob.size,
  })
  if (error) throw error
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  const { data, error } = await client().from('blobs').select('path').eq('id', id).maybeSingle()
  if (error) throw error
  const path = (data as { path: string } | null)?.path
  if (!path) return undefined
  const res = await fetch(publicBlobUrl(path))
  if (!res.ok) return undefined
  return res.blob()
}

export async function deleteBlob(id: string): Promise<void> {
  const { data, error } = await client().from('blobs').select('path').eq('id', id).maybeSingle()
  if (error) throw error
  const path = (data as { path: string } | null)?.path
  if (path) {
    const rm = await client().storage.from('blobs').remove([path])
    if (rm.error) throw rm.error
  }
  const { error: de } = await client().from('blobs').delete().eq('id', id)
  if (de) throw de
}

/** 레이어에 속한 피처 id. 레이어 삭제 시 Storage 객체를 미리 지우기 위해 필요하다. */
async function featureIdsOfLayers(layerIds: string[]): Promise<string[]> {
  if (!layerIds.length) return []
  const { data, error } = await client().from('features').select('id').in('layer_id', layerIds)
  if (error) throw error
  return ((data ?? []) as { id: string }[]).map((r) => r.id)
}

/**
 * 해당 피처들에 달린 이미지를 Storage 에서 먼저 지운다.
 * FK cascade 는 blobs 메타 행만 지우고 Storage 객체는 남긴다 (스펙 4.5).
 */
async function purgeBlobsOfFeatures(featureIds: string[]): Promise<void> {
  if (!featureIds.length) return
  const { data, error } = await client().from('blobs').select('path').in('feature_id', featureIds)
  if (error) throw error
  const paths = ((data ?? []) as { path: string }[]).map((r) => r.path)
  if (!paths.length) return
  const rm = await client().storage.from('blobs').remove(paths)
  if (rm.error) throw rm.error
  // 메타 행은 features 삭제 시 cascade 로 사라진다. 여기서 또 지우지 않는다.
}

export async function loadAll(projectId: string): Promise<{
  project: Project | undefined
  layers: Layer[]
  features: Feature[]
}> {
  await inFlight
  const c = client()
  const [p, l, f] = await Promise.all([
    c.from('projects').select('*').eq('id', projectId).maybeSingle(),
    c.from('layers').select('*').eq('project_id', projectId).order('order'),
    c.from('features').select('*').eq('project_id', projectId),
  ])
  if (p.error) throw p.error
  if (l.error) throw l.error
  if (f.error) throw f.error
  return {
    project: p.data ? rowToProject(p.data as ProjectRow) : undefined,
    layers: ((l.data ?? []) as LayerRow[]).map(rowToLayer),
    features: ((f.data ?? []) as FeatureRow[]).map(rowToFeature),
  }
}

/**
 * 헤더의 프로젝트가 서버에 있는지 확인해 그 id 를 돌려준다.
 * RLS 가 다른 프로젝트를 보여주지 않으므로 "첫 프로젝트" = "그 프로젝트"다.
 * 없으면 undefined — 링크가 잘못됐거나 아직 만들지 않은 경우다.
 */
export async function firstProjectId(): Promise<string | undefined> {
  const { data, error } = await client().from('projects').select('id').limit(1).maybeSingle()
  if (error) throw error
  return (data as { id: string } | null)?.id
}
