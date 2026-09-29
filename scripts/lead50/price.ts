/**
 * 진입가 구간 레이어 동기화. 원본(구간 레이어 5개 + 순위 밖)의 거래 블록에서 진입가(평형별 최신 거래 중 최저)를 구해
 * 원본에 entryTrade 를 채우고, PRICE_LAYERS 6개에 사본을 맞춘다. KB·국토부를 부르지 않는다.
 *   node scripts/lead50/price.ts <projectId> [--dry-run]
 * run.ts 도 끝에서 syncPrice 를 부른다. 사본 레이어는 스크립트 소유 — 새 목록에 없는 도형은 지운다.
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BAND_LAYERS, OUT_LAYER, PRICE_LAYERS, mergeSchema, priceRows } from './build.ts'
import { ensureLayer, findLayer, readLayerFeatures, readLayers, supabaseClient, upsertFeatures } from './sb.ts'
import type { Sb } from './sb.ts'
import type { FeatureRow, LayerRow } from '../../src/db/mappers.ts'
import type { PropertySchemaField } from '../../src/types.ts'

export async function syncPrice(sb: Sb, projectId: string, dryRun: boolean): Promise<void> {
  const layers = await readLayers(sb, projectId)
  const existed = new Set(layers.map((l) => l.id))
  const sources = [...BAND_LAYERS, OUT_LAYER].map((d) => findLayer(layers, d.name)).filter((l): l is LayerRow => !!l)
  if (!sources.length) throw new Error('월간선도50 레이어가 없다')
  // 원본 레이어 스키마에 entryTrade 필드를 넣는다 (mergeSchema 가 SCHEMA 순서로 맞춘다).
  for (const l of sources) await ensureLayer(sb, projectId, layers, { name: l.name, color: l.style.color, visible: l.visible }, l.id, dryRun)
  // 사본은 원본 속성을 전부 가져가므로 스키마도 원본 레이어 것을 따른다 (다른 스크립트가 붙인 필드 — 예: scripts/transit 의 소요시간).
  // 스키마 밖 속성은 앱이 텍스트 칸으로 보여줘서 숫자가 "비어 있음" 으로 보였다.
  const extra = sources[0].schema
  const withSource = (existing: PropertySchemaField[]) => {
    const merged = mergeSchema(existing)
    const have = new Set(merged.map((f) => f.key))
    return [...merged, ...extra.filter((f) => !have.has(f.key))]
  }
  const priceLayers: LayerRow[] = []
  for (const [i, def] of PRICE_LAYERS.entries()) priceLayers.push(await ensureLayer(sb, projectId, layers, def, `lyr_price${i}_${projectId.slice(0, 8)}`, dryRun, withSource))

  const source: FeatureRow[] = []
  for (const l of sources) source.push(...(await readLayerFeatures(sb, l.id)))
  const now = new Date().toISOString()
  const { originals, copies } = priceRows(source, priceLayers.map((l) => l.id), now)
  const changed = originals.filter((f) => f.updated_at === now)

  const keep = new Set(copies.map((c) => c.id))
  const stale: FeatureRow[] = []
  for (const l of priceLayers) if (existed.has(l.id)) stale.push(...(await readLayerFeatures(sb, l.id)).filter((f) => !f.derived_from && !keep.has(f.id)))

  const perLayer = Object.fromEntries(priceLayers.map((l) => [l.name, copies.filter((c) => c.layer_id === l.id).length]))
  console.log(JSON.stringify({ source: source.length, withEntry: originals.length, entryUpdated: changed.length, perLayer, deleted: stale.length, dryRun }, null, 2))
  if (dryRun) return

  await upsertFeatures(sb, [...changed, ...copies])
  for (let i = 0; i < stale.length; i += 100) {
    const ids = stale.slice(i, i + 100).map((f) => `"${f.id}"`).join(',')
    await sb(`features?id=in.(${ids})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
  }
  console.error(`진입가 기록 완료: 원본 ${changed.length}, 사본 ${copies.length}, 삭제 ${stale.length}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [projectId] = process.argv.slice(2)
  if (!projectId || !/^[0-9a-f-]{36}$/.test(projectId)) {
    console.error('usage: node scripts/lead50/price.ts <projectId> [--dry-run]')
    process.exit(2)
  }
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)))
  await syncPrice(supabaseClient(projectId), projectId, process.argv.includes('--dry-run'))
}
