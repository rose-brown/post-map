import { useCallback, useEffect, useState } from 'react'
import { commitLink, decideProjectId, readLink } from '../db/project-link'
import { countLocal, migrateLocalToServer } from '../db/migrate-local'
import { createProject } from '../db/repo'
import { hasSupabaseConfig } from '../db/supabase'
import { userInput } from '../persist/persistable'
import { nowIso, SCHEMA_VERSION } from '../types'
import type { Project } from '../types'
import { newLayer, useStore } from '../store/useStore'

type Phase = 'deciding' | 'ask' | 'working' | 'error'

/**
 * 어느 프로젝트를 열지 정하고, 필요하면 이관을 안내한다 (스펙 4.4·4.5).
 *
 * 읽기 실패 시 빈 지도를 보여주지 않는다 — 데이터가 지워진 것으로 오인된다.
 * 그래서 useStore.init() 은 프로젝트가 없으면 던지고, 여기서 오류와 재시도를 띄운다.
 */
export function StartGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>('deciding')
  const [msg, setMsg] = useState('')
  const [features, setFeatures] = useState(0)
  const ready = useStore((s) => s.ready)
  const init = useStore((s) => s.init)

  const open = useCallback(
    async (id: string) => {
      setPhase('working')
      try {
        commitLink(id)
        await init(id)
      } catch (e) {
        setMsg(e instanceof Error ? e.message : String(e))
        setPhase('error')
      }
    },
    [init],
  )

  const run = useCallback(async (job: () => Promise<string>) => {
    setPhase('working')
    try {
      await open(await job())
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
      setPhase('error')
    }
  }, [open])

  useEffect(() => {
    if (!hasSupabaseConfig) {
      setMsg('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 없습니다. .env 를 확인하세요.')
      setPhase('error')
      return
    }
    const id = decideProjectId(readLink())
    if (id) {
      void open(id)
      return
    }
    void countLocal()
      .then((c) => {
        setFeatures(c.features)
        setPhase('ask')
      })
      .catch(() => setPhase('ask'))
  }, [open])

  if (ready) return <>{children}</>

  if (phase === 'error') {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-[420px] space-y-3 text-center">
          <p className="font-medium">지도를 열 수 없습니다</p>
          <p className="text-sm text-ink-mut">{msg}</p>
          <button
            onClick={() => window.location.reload()}
            className="touch-target rounded-lg bg-brand px-4 text-sm font-medium text-white"
            data-testid="start-retry"
          >
            다시 시도
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'ask') {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-[420px] space-y-3">
          {features > 0 ? (
            <>
              <p className="font-medium">이 기기에 기록 {features}건이 있습니다</p>
              <p className="text-sm text-ink-mut">
                서버로 복사하면 다른 기기에서도 볼 수 있습니다. 이 기기의 원본은 지우지 않습니다.
              </p>
              <button
                onClick={() => void run(migrateLocalToServer)}
                className="touch-target w-full rounded-lg bg-brand px-4 text-sm font-medium text-white"
                data-testid="start-migrate"
              >
                서버로 복사
              </button>
            </>
          ) : (
            <p className="font-medium">새 지도를 시작합니다</p>
          )}
          <button
            onClick={() => void run(newProject)}
            className="touch-target w-full rounded-lg border border-line px-4 text-sm font-medium"
            data-testid="start-fresh"
          >
            {features > 0 ? '복사하지 않고 새로 시작' : '시작'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="grid h-full place-items-center text-sm text-ink-mut">불러오는 중…</div>
  )
}

/** 빈 프로젝트와 기본 레이어. id 는 createProject 가 만들므로 빈 문자열로 보낸다. */
async function newProject(): Promise<string> {
  const project: Project = {
    id: '',
    name: '새 프로젝트',
    description: '',
    initialView: { lng: 126.978, lat: 37.5665, zoom: 12, bearing: 0, pitch: 0 },
    schemaVersion: SCHEMA_VERSION,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  // projectId 는 createProject 가 만든 uuid 로 채워진다.
  const layer = newLayer('', 0, '기본 레이어')
  return createProject(userInput(project), userInput(layer))
}
