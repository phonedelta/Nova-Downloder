/**
 * Single source for NovaDownloader API / web base URLs.
 * Configure via VITE_NOVA_API_BASE_URL and VITE_NOVA_WEB_BASE_URL.
 * Also used as the public download base when the backend returns a relative path.
 */
export const NOVA_API_BASE_URL = (
  import.meta.env.VITE_NOVA_API_BASE_URL || "http://127.0.0.1:3001"
).replace(/\/$/, "");

/** Same origin Chrome must use to fetch stream bytes (never Docker hostnames). */
export const NOVA_PUBLIC_DOWNLOAD_BASE_URL = (
  import.meta.env.VITE_NOVA_PUBLIC_DOWNLOAD_BASE_URL || NOVA_API_BASE_URL
).replace(/\/$/, "");

export const NOVA_WEB_BASE_URL = (
  import.meta.env.VITE_NOVA_WEB_BASE_URL || "http://127.0.0.1:5173"
).replace(/\/$/, "");

export const IS_EXTENSION_PROD_BUILD =
  import.meta.env.VITE_NOVA_ENV === "production";

export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${NOVA_API_BASE_URL}${p.startsWith("/api") ? p : `/api${p}`}`;
}

export function webUrlWithVideo(url: string): string {
  return `${NOVA_WEB_BASE_URL}/?url=${encodeURIComponent(url)}`;
}

/** Turn a prepare downloadUrl into an absolute browser-reachable URL. */
export function resolvePublicDownloadUrl(downloadUrl: string): string {
  const raw = String(downloadUrl || "").trim();
  if (!raw) throw new Error("Missing downloadUrl");
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  if (raw.startsWith("/")) {
    return new URL(raw, `${NOVA_PUBLIC_DOWNLOAD_BASE_URL}/`).toString();
  }
  throw new Error("Invalid download URL");
}

/** Reject relative paths, prepare endpoints, extension URLs, and non-http(s). */
export function assertBrowserDownloadUrl(downloadUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(downloadUrl);
  } catch {
    throw new Error("Invalid download URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Invalid download protocol");
  }
  const path = parsed.pathname.toLowerCase();
  if (path.includes("/download/prepare")) {
    throw new Error("Refuse de télécharger l’endpoint prepare (JSON).");
  }
  if (
    !path.includes("/download/stream/") &&
    !path.includes("/download/generic/stream/")
  ) {
    throw new Error("downloadUrl n’est pas une URL de stream NovaDownloader.");
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "backend" || host === "api" || host === "server") {
    throw new Error("Serveur NovaDownloader indisponible.");
  }
  if (
    IS_EXTENSION_PROD_BUILD &&
    (host === "localhost" || host === "127.0.0.1" || host === "::1")
  ) {
    throw new Error("Serveur NovaDownloader indisponible.");
  }
  return parsed;
}

/** Short health probe — never start chrome.downloads if this fails. */
export async function checkApiHealth(timeoutMs = 4000): Promise<void> {
  const url = apiUrl("/health");
  console.log("[NOVA HEALTH] GET", url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || "";
    console.log("[NOVA HEALTH] status =", response.status, contentType);
    if (!response.ok) {
      throw new Error("Serveur NovaDownloader indisponible.");
    }
    let data: { status?: string };
    try {
      data = (await response.json()) as { status?: string };
    } catch {
      throw new Error("Serveur NovaDownloader indisponible.");
    }
    if (data.status !== "ok") {
      throw new Error("Serveur NovaDownloader indisponible.");
    }
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("Serveur NovaDownloader indisponible.");
    }
    if (
      e instanceof Error &&
      e.message.includes("Serveur NovaDownloader indisponible")
    ) {
      throw e;
    }
    throw new Error("Serveur NovaDownloader indisponible.");
  } finally {
    clearTimeout(timer);
  }
}
