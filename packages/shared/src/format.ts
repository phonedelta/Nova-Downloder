export const duration = (s: number) =>
  [Math.floor(s / 3600) || null, Math.floor(s / 60) % 60, s % 60]
    .filter((v) => v !== null)
    .map((v, i) => (i ? String(v).padStart(2, "0") : String(v)))
    .join(":");

export function youtubeUrl(value: string) {
  try {
    const u = new URL(value);
    if (
      !["https:", "http:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.port
    )
      return null;
    const host = u.hostname.toLowerCase();
    let id: string | null = null;
    if (host === "youtu.be") id = u.pathname.slice(1);
    else if (
      [
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
      ].includes(host)
    ) {
      if (u.pathname === "/watch") id = u.searchParams.get("v");
      else id = u.pathname.match(/^\/(shorts|live)\/([\w-]+)\/?$/)?.[2] || null;
    }
    return id && /^[\w-]{11}$/.test(id)
      ? `https://www.youtube.com/watch?v=${id}`
      : null;
  } catch {
    return null;
  }
}

export function extractVideoId(value: string): string | null {
  const normalized = youtubeUrl(value);
  if (!normalized) return null;
  return new URL(normalized).searchParams.get("v");
}

export function safeName(s: string) {
  return (
    s
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
      .replace(/^\.+/, "")
      .trim()
      .slice(0, 140) || "video"
  );
}

export function videoFilename(title: string, height: number, ext = "mp4") {
  return `${safeName(title)} - ${height}p.${ext}`;
}

export function audioFilename(title: string, channel?: string) {
  return `${safeName(audioDisplayTitle(title, channel))}.mp3`;
}

/** Display / ID3 title for MP3: "Chaîne - Titre vidéo". */
export function audioDisplayTitle(title: string, channel?: string): string {
  const t = String(title || "").trim() || "audio";
  const c = String(channel || "").trim();
  if (!c) return t;
  if (t === c || t.startsWith(`${c} - `)) return t;
  return `${c} - ${t}`;
}

export function subtitleFilename(title: string, lang: string) {
  return `${safeName(title)} - ${safeName(lang)}.srt`;
}

export type NovaDownloadKind = "video" | "audio" | "subtitles";

/** Sanitize a bare filename; keeps Unicode and the file extension. */
export function sanitizeFilename(filename: string): string {
  const base =
    filename.replace(/\\/g, "/").split("/").pop()?.trim() || "download";
  const lastDot = base.lastIndexOf(".");
  const hasExt = lastDot > 0 && lastDot < base.length - 1;
  const namePart = hasExt ? base.slice(0, lastDot) : base;
  const extPart = hasExt ? base.slice(lastDot).toLowerCase() : "";
  return `${safeName(namePart)}${extPart}`;
}

/**
 * Relative path under the browser Downloads folder.
 * "Vedio" spelling is intentional (product folder name).
 */
export function getDownloadPath(
  type: NovaDownloadKind,
  filename: string,
): string {
  const safe = sanitizeFilename(filename);
  if (type === "video") return `Nova Downloader/Vedio/${safe}`;
  if (type === "audio") return `Nova Downloader/Music/${safe}`;
  return `Nova Downloader/Sous-titre/${safe}`;
}

export function getExtensionForDownload(
  type: NovaDownloadKind,
  preferred?: string,
): string {
  if (type === "audio") return "mp3";
  if (type === "subtitles") return "srt";
  const ext = (preferred || "mp4").replace(/^\./, "").toLowerCase();
  if (ext === "webm" || ext === "mkv" || ext === "mp4") return ext;
  return "mp4";
}

export function qualityLabel(height: number): string {
  if (height >= 4320) return "8K";
  if (height >= 2160) return "4K";
  if (height >= 1440) return "1440p";
  if (height >= 1080) return "Full HD";
  if (height >= 720) return "HD";
  return "";
}
