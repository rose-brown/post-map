/**
 * 월간선도50 스크립트의 Supabase REST 호출. .env 의 anon 키 + x-project-id 헤더 — 앱과 같은 권한 (RLS).
 * 불변 규칙 1 의 명시적 예외 (스펙 D2): 앱의 저장 게이트를 거치지 않고 직접 쓴다.
 */
import { mergeSchema } from './build.ts'
import type { LayerDef } from './build.ts'
import type { FeatureRow, LayerRow } from '../../src/db/mappers.ts'

export type Sb = (path: string, init?: RequestInit) => Promise<unknown>

export function supabaseClient(projectId: string): Sb {
  const { VITE_SUPABASE_URL: SB, VITE_SUPABASE_ANON_KEY: ANON } = process.env
  if (!SB || !ANON) throw new Error('.env 에 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 필요하다')
  const headers = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'x-project-id': projectId, 'Content-Type': 'application/json' }
  return async (path, init = {}) => {
    const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } })
    const text = await r.text()
    if (!r.ok) throw new Error(`Supabase ${r.status} ${path.split('?')[0]}: ${text}`)
    // return=minimal 이면 본문이 비어 온다.
    return text ? JSON.parse(text) : null
  }
}

/** 서버가 한 응답을 1000행으로 자른다 — 끝까지 이어 받는다. */
export async function readLayerFeatures(sb: Sb, layerId: string): Promise<FeatureRow[]> {
  const out: FeatureRow[] = []
  for (let offset = 0; ; offset += 1000) {
    const page = (await sb(`features?layer_id=eq.${layerId}&select=*&order=id&limit=1000&offset=${offset}`)) as FeatureRow[]
    out.push(...page)
    if (page.length < 1000) break
  }
  return out
}

export const readLayers = async (sb: Sb, projectId: string) =>
  (await sb(`layers?project_id=eq.${projectId}&select=*`)) as LayerRow[]

/** 레이어는 이름으로 찾는다. 같은 이름이 둘 이상이면 어느 쪽에 쓸지 모르므로 실패한다. */
export function findLayer(layers: LayerRow[], name: string): LayerRow | undefined {
  const hit = layers.filter((l) => l.name === name)
  if (hit.length > 1) throw new Error(`"${name}" 레이어가 ${hit.length}개다. 하나만 남겨라.`)
  return hit[0]
}

/**
 * 이름으로 찾아 스키마를 갱신하거나, 없으면 만든다 (layers 배열에도 넣는다 — 다음 order 계산용).
 * 기존 레이어의 스타일은 sizeField 키가 없을 때만 채운다 — 색·표시 상태 등 사용자가 바꾼 것은 덮지 않는다.
 * dryRun 이면 쓰지 않고 만들 id 만 돌려준다.
 */
export async function ensureLayer(sb: Sb, projectId: string, layers: LayerRow[], def: LayerDef, newId: string, dryRun: boolean): Promise<LayerRow> {
  const found = findLayer(layers, def.name)
  if (found) {
    const style = def.sizeField && !('sizeField' in found.style) ? { ...found.style, sizeField: def.sizeField } : found.style
    if (!dryRun) await sb(`layers?id=eq.${found.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ schema: mergeSchema(found.schema), style }) })
    found.style = style
    return found
  }
  const layer: LayerRow = {
    id: newId, project_id: projectId, name: def.name, kind: 'vector', visible: def.visible,
    order: layers.reduce((m, l) => Math.max(m, l.order), -1) + 1,
    style: { color: def.color, opacity: 0.25, strokeWidth: 2, pointRadius: 6, ...(def.sizeField ? { sizeField: def.sizeField } : {}) },
    schema: mergeSchema([]), locked: false,
  }
  if (!dryRun) await sb('layers', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(layer) })
  layers.push(layer)
  return layer
}

/** upsert 500행 단위. return=minimal 인 이유: RLS 에서 RETURNING 이 42501 을 낸 적이 있다 (CLAUDE.md 함정). */
export async function upsertFeatures(sb: Sb, rows: FeatureRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    await sb('features', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows.slice(i, i + 500)) })
  }
}
