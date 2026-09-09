/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_ASSISTANT_VOICE?: string
  readonly VITE_ASSISTANT_WAKE_PHRASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
