/**
 * 어느 프로젝트를 열지 정한다. 우선순위: URL ?p= → localStorage → 없음 (스펙 4.4).
 *
 * localStorage 기록이 없으면 링크를 잃는 순간 데이터에 접근할 수 없다. 로그인이 없어서
 * 계정으로 되찾을 방법이 없기 때문이다. 그래서 URL 과 localStorage 양쪽에 남긴다.
 *
 * uuid 는 이 앱에서 사실상 비밀이다. 형태가 맞지 않는 값은 서버에 보내기 전에 버린다 —
 * 틀린 헤더는 어차피 0건이지만, 잘못된 값을 URL 에 다시 쓰지 않기 위해서다.
 *
 * decideProjectId 는 순수 함수다. tests/project-link.test.ts 가 Node 로 직접 돌리므로
 * 이 파일은 런타임 import 를 들이지 않는다.
 */
const KEY = 'map-editor:projectId'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const valid = (v: string | null): string | null => (v && UUID_RE.test(v) ? v : null)

export interface LinkSource {
  url: string | null
  stored: string | null
}

export function decideProjectId(src: LinkSource): string | null {
  return valid(src.url) ?? valid(src.stored)
}

export function readLink(): LinkSource {
  const url = new URLSearchParams(window.location.search).get('p')
  let stored: string | null = null
  try {
    stored = window.localStorage.getItem(KEY)
  } catch {
    // 프라이빗 창 등에서 접근이 막힐 수 있다. URL 만으로도 동작해야 한다.
  }
  return { url, stored }
}

/** 정해진 id 를 URL 과 localStorage 양쪽에 남긴다. */
export function commitLink(id: string): void {
  const u = new URL(window.location.href)
  if (u.searchParams.get('p') !== id) {
    u.searchParams.set('p', id)
    window.history.replaceState(null, '', u)
  }
  try {
    window.localStorage.setItem(KEY, id)
  } catch {
    // 위와 같다. URL 에는 남았으므로 북마크로 복구할 수 있다.
  }
}
