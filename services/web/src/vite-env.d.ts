/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Gateway base URL the browser calls (e.g. http://localhost:8080). */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
