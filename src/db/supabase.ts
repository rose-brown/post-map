import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * 불변 규칙 4 의 예외 — anon(publishable) key 는 번들에 들어간다.
 *
 * 이 키는 처음부터 공개를 전제로 설계된 식별자이고, 실제 방어선은 RLS 다.
 * 정책이 x-project-id 헤더와 행의 project_id 를 비교하므로, 키를 알아도
 * 프로젝트 uuid 를 모르면 아무 행도 읽히지 않는다 (supabase/schema.sql 참조).
 * 따라서 프록시 뒤로 숨길 대상이 아니다. 숨겨야 하는 것은 secret(service_role) 키이고,
 * 그 키는 이 저장소에 존재하지 않는다.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const hasSupabaseConfig = Boolean(url && anonKey)

function assertConfig(): { url: string; anonKey: string } {
  if (!url || !anonKey) {
    throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 없습니다. .env 를 확인하세요.')
  }
  return { url, anonKey }
}

/**
 * 프로젝트 uuid 가 정해진 뒤에 만든다. 헤더가 모든 요청에 붙는다.
 * 로그인이 없으므로 세션을 유지할 것이 없다 — persistSession 을 끈다.
 */
export function makeClient(projectId: string): SupabaseClient {
  const c = assertConfig()
  return createClient(c.url, c.anonKey, {
    auth: { persistSession: false },
    global: { headers: { 'x-project-id': projectId } },
  })
}

/** 이미지 공개 URL. public 버킷이라 서명이 필요 없다 (스펙 D9). */
export function publicBlobUrl(path: string): string {
  const c = assertConfig()
  return `${c.url}/storage/v1/object/public/blobs/${path}`
}
