import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * 불변 규칙 4 — API 키를 클라이언트 번들에 넣지 않는다.
 *
 * 검색·지오코딩은 이 dev 프록시를 경유한다. 프록시가 서버 쪽에서 key 파라미터를 붙이므로
 * VWORLD_SEARCH_KEY 는 번들에 들어가지 않는다 (VITE_ 접두사가 없는 변수는 클라이언트에 노출되지 않는다).
 *
 * 예외는 배경지도 타일뿐이다. VWorld 타일 키는 도메인 등록 방식이라 타일 URL 에 그대로 실려야 하고,
 * 프록시 뒤로 숨길 수 없다. 그래서 VITE_VWORLD_KEY 만 번들에 들어간다. (src/providers/basemap.ts 주석 참조)
 *
 * 한 문장 경고: 두 변수에 같은 키를 넣으면 타일 쪽에서 이미 노출되므로 프록시가 키를 가려주지 못한다.
 * 운영에서는 타일용 키와 검색용 키를 따로 발급해라.
 *
 * 이 프록시는 **개발 전용**이다. `vite build` 산출물에는 프록시가 없다.
 * Phase 3 에서 Supabase Edge Function 으로 대체한다.
 */
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const searchKey = env.VWORLD_SEARCH_KEY || env.VITE_VWORLD_KEY || ''

  const withKey = (upstreamPath: string) => (path: string) => {
    const qs = path.includes('?') ? path.slice(path.indexOf('?') + 1) : ''
    const params = new URLSearchParams(qs)
    params.set('key', searchKey)
    return `${upstreamPath}?${params.toString()}`
  }

  // GitHub Pages 는 https://<user>.github.io/<repo>/ 로 서빙되므로 하위 경로가 필요하다.
  // dev 서버는 루트를 그대로 쓴다.
  // CI 는 process.env 로 넘기고, 로컬은 .env 로도 덮어쓸 수 있게 둔다.
  const base =
    command === 'build' ? (process.env.BASE_PATH || env.BASE_PATH || '/post-map/') : '/'

  return {
    base,
    plugins: [react(), tailwindcss()],
    optimizeDeps: {
      // MapLibre 는 자체 웹 워커를 별도 청크로 로드한다. Vite 의 의존성 사전 번들링을 거치면
      // 워커 URL 이 /node_modules/.vite/deps/maplibre-gl-worker.mjs 로 바뀌는데 그 파일은 없어 404 가 난다.
      // 워커가 죽으면 GeoJSON 소스를 타일링하지 못해 **벡터 레이어만** 렌더되지 않는다
      // (래스터 배경지도는 워커를 쓰지 않아 멀쩡해서 원인을 찾기 어렵다).
      exclude: ['maplibre-gl'],
    },
    server: {
      proxy: {
        '/api/vworld/search': {
          target: 'https://api.vworld.kr',
          changeOrigin: true,
          rewrite: withKey('/req/search'),
        },
        '/api/vworld/address': {
          target: 'https://api.vworld.kr',
          changeOrigin: true,
          rewrite: withKey('/req/address'),
        },
      },
    },
  }
})
