/**
 * TOP 레이어 동기화 (계획 docs/superpowers/plans/2026-09-29-lead50-top9-layer.md).
 * 서버의 TOP1~10 구간 레이어를 읽어 순위 1~9 사본 레이어를 새로 맞춘다. KB·국토부를 부르지 않는다.
 *   node scripts/lead50/top9.ts <projectId> [--dry-run]
 * run.ts 도 구간 레이어를 쓴 뒤 syncTop 을 부른다.
 * 사본 레이어는 스크립트 소유다 — 새 목록에 없는 도형(사용자가 그린 것 포함)은 지운다 (T2).
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BAND_LAYERS, SIZE_FIELD, TOP_LAYER_NAME, topRows } from './build.ts'
import { ensureLayer, findLayer, readLayerFeatures, readLayers, supabaseClient, upsertFeatures } from './sb.ts'
import type { Sb } from './sb.ts'

export async function syncTop(sb: Sb, projectId: string, dryRun: boolean): Promise<void> {
  const layers = await readLayers(sb, projectId)
  const source = findLayer(layers, BAND_LAYERS[0].name)
  if (!source) throw new Error(`"${BAND_LAYERS[0].name}" 레이어가 없다`)
  const existed = findLayer(layers, TOP_LAYER_NAME)
  const top = await ensureLayer(sb, projectId, layers, { name: TOP_LAYER_NAME, color: '#7c3aed', visible: true, sizeField: SIZE_FIELD }, `lyr_top9_${projectId.slice(0, 8)}`, dryRun)

  const rows = topRows(await readLayerFeatures(sb, source.id), top.id, new Date().toISOString())
  const keep = new Set(rows.map((r) => r.id))
  // 링(derived)은 parent_id FK cascade 로 중심과 같이 지워진다.
  const stale = existed ? (await readLayerFeatures(sb, existed.id)).filter((f) => !f.derived_from && !keep.has(f.id)) : []
  console.log(JSON.stringify({ topLayer: TOP_LAYER_NAME, rows: rows.length, deleted: stale.length, dryRun }))
  if (dryRun) return

  await upsertFeatures(sb, rows)
  for (let i = 0; i < stale.length; i += 100) {
    const ids = stale.slice(i, i + 100).map((f) => `"${f.id}"`).join(',')
    await sb(`features?id=in.(${ids})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
  }
  console.error(`TOP 기록 완료: ${rows.length}행, 삭제 ${stale.length}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [projectId] = process.argv.slice(2)
  if (!projectId || !/^[0-9a-f-]{36}$/.test(projectId)) {
    console.error('usage: node scripts/lead50/top9.ts <projectId> [--dry-run]')
    process.exit(2)
  }
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)))
  await syncTop(supabaseClient(projectId), projectId, process.argv.includes('--dry-run'))
}
