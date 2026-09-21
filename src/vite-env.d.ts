/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_VWORLD_KEY?: string
  /** 직접 세운 프록시가 있을 때 'true' 로 두면 검색을 켠다. */
  readonly VITE_SEARCH_PROXY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
