/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NOVA_API_BASE_URL?: string;
  readonly VITE_NOVA_PUBLIC_DOWNLOAD_BASE_URL?: string;
  readonly VITE_NOVA_WEB_BASE_URL?: string;
  readonly VITE_NOVA_DEBUG?: string;
  readonly VITE_NOVA_ENV?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.css?inline" {
  const css: string;
  export default css;
}
