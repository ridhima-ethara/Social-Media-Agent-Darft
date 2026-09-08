/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_JARVIS_VOICE?: string
  readonly VITE_JARVIS_WAKE_PHRASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
