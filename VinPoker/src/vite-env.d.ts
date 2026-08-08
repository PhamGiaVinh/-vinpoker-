/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __APP_GIT_COMMIT_SHA__: string | null;

interface ImportMetaEnv {
  readonly VITE_SENTRY_DSN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
