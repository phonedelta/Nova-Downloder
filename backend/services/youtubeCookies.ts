import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

let cachedPath: string | null | undefined;

function decodeCookiesPayload(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  // Already Netscape / cookies.txt
  if (
    trimmed.includes("# Netscape") ||
    trimmed.includes("youtube.com") ||
    trimmed.includes(".youtube.com")
  ) {
    return trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`;
  }
  // Base64 payload
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8");
    if (
      decoded.includes("youtube.com") ||
      decoded.includes("# Netscape") ||
      decoded.includes(".youtube.com")
    ) {
      return decoded.endsWith("\n") ? decoded : `${decoded}\n`;
    }
  } catch {
    /* fall through */
  }
  return trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`;
}

/**
 * Resolve a cookies.txt path for yt-dlp on servers (Railway).
 * Supports:
 * - YT_DLP_COOKIES=/path/to/cookies.txt
 * - YT_DLP_COOKIES_CONTENT=<netscape text or base64>
 * - YT_DLP_COOKIES_BASE64=<base64 netscape file>
 */
export function resolveCookiesFile(): string | null {
  if (cachedPath !== undefined) return cachedPath;

  const configured = process.env.YT_DLP_COOKIES?.trim();
  if (configured && existsSync(configured)) {
    cachedPath = configured;
    return cachedPath;
  }

  const payload =
    process.env.YT_DLP_COOKIES_CONTENT?.trim() ||
    process.env.YT_DLP_COOKIES_BASE64?.trim() ||
    "";
  if (!payload) {
    cachedPath = null;
    return null;
  }

  const text = decodeCookiesPayload(payload);
  if (!text || text.length < 20) {
    console.warn("[cookies] YT_DLP_COOKIES_* is set but empty/invalid");
    cachedPath = null;
    return null;
  }

  const out = join(tmpdir(), "nova-youtube-cookies.txt");
  try {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, text, { mode: 0o600 });
    console.log("[cookies] Wrote YouTube cookies for yt-dlp:", out);
    cachedPath = out;
    return cachedPath;
  } catch (e) {
    console.warn("[cookies] Failed to write cookies file:", e);
    cachedPath = null;
    return null;
  }
}

export function cookiesArgs(): string[] {
  const file = resolveCookiesFile();
  if (file) return ["--cookies", file];

  // Browser cookies: local only (not available on Railway)
  const useCookies = process.env.YT_DLP_USE_COOKIES === "1";
  const browser = process.env.YT_DLP_COOKIES_FROM_BROWSER?.trim();
  if (useCookies && browser) return ["--cookies-from-browser", browser];
  return [];
}
