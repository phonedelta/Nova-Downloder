const isDev = import.meta.env.DEV;

export function debugLog(...args: unknown[]): void {
  if (isDev || import.meta.env.VITE_NOVA_DEBUG === "1") {
    console.debug("[NovaDownloader]", ...args);
  }
}
