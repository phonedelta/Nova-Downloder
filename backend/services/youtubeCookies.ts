import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { gunzipSync } from "node:zlib";

let cachedPath: string | null | undefined;

function looksLikeCookies(text: string): boolean {
  return (
    text.includes("# Netscape") ||
    text.includes("youtube.com") ||
    text.includes(".youtube.com") ||
    text.includes("google.com")
  );
}

function decodeCookiesPayload(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (looksLikeCookies(trimmed)) {
    return trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`;
  }

  try {
    const buf = Buffer.from(trimmed.replace(/\s+/g, ""), "base64");
    let decodedBuf = buf;
    if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
      decodedBuf = gunzipSync(buf);
    }
    const decoded = decodedBuf.toString("utf8");
    if (looksLikeCookies(decoded)) {
      return decoded.endsWith("\n") ? decoded : `${decoded}\n`;
    }
  } catch {
    /* fall through */
  }
  return "";
}

/** Clear memoized cookies path (after admin upload / env change). */
export function resetCookiesCache() {
  cachedPath = undefined;
}

/**
 * Resolve a cookies.txt path for yt-dlp on servers (Railway).
 * Supports:
 * - YT_DLP_COOKIES=/path/to/cookies.txt
 * - YT_DLP_COOKIES_CONTENT=<netscape text>
 * - YT_DLP_COOKIES_BASE64=<base64 netscape, optionally gzip>
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
    console.log(
      "[cookies] Wrote YouTube cookies for yt-dlp:",
      out,
      `(${text.length} bytes)`,
    );
    cachedPath = out;
    return cachedPath;
  } catch (e) {
    console.warn("[cookies] Failed to write cookies file:", e);
    cachedPath = null;
    return null;
  }
}

/**
 * Install cookies from a base64/gzip payload (runtime, e.g. admin API).
 */
export function installCookiesFromBase64(payload: string): string | null {
  process.env.YT_DLP_COOKIES_BASE64 = payload.trim();
  delete process.env.YT_DLP_COOKIES_CONTENT;
  resetCookiesCache();
  return resolveCookiesFile();
}

export function cookiesArgs(): string[] {
  const file = resolveCookiesFile();
  if (file) return ["--cookies", file];

  const useCookies = process.env.YT_DLP_USE_COOKIES === "1";
  const browser = process.env.YT_DLP_COOKIES_FROM_BROWSER?.trim();
  if (useCookies && browser) return ["--cookies-from-browser", browser];
  return [];
}
