/**
 * 프로젝트의 모든 레이어 스키마에 필터 버튼 값을 맞춘다 (스펙 filter-buttons E5·E6). 사본 레이어도 key 로 같이 맞는다.
 *   node scripts/presets/run.ts <projectId> [--dry-run]
 * lead50/run.ts 가 끝에서 부른다. scripts/transit 을 돌린 뒤에도 다시 돌린다.
 * 앱 탭이 열려 있으면 새로고침한다 — 옛 스키마로 레이어를 저장하면 presets 가 덮인다.
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readLayers, supabaseClient } from '../lead50/sb.ts'
import type { Sb } from '../lead50/sb.ts'
import { withPresets } from './presets.ts'

export async function syncPresets(sb: Sb, projectId: string, dryRun: boolean): Promise<void> {
  const layers = await readLayers(sb, projectId)
  const changed = layers.filter((l) => JSON.stringify(withPresets(l.schema)) !== JSON.stringify(l.schema))
  console.log(JSON.stringify({ layers: layers.length, changed: changed.map((l) => l.name), dryRun }, null, 2))
  if (dryRun) return
  for (const l of changed) {
    await sb(`layers?id=eq.${l.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ schema: withPresets(l.schema) }) })
  }
  console.error(`버튼 값 기록 완료: 레이어 ${changed.length}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [projectId] = process.argv.slice(2)
  if (!projectId || !/^[0-9a-f-]{36}$/.test(projectId)) {
    console.error('usage: node scripts/presets/run.ts <projectId> [--dry-run]')
    process.exit(2)
  }
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)))
  await syncPresets(supabaseClient(projectId), projectId, process.argv.includes('--dry-run'))
}
