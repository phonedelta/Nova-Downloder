import { createReadStream } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn, type ChildProcess } from "node:child_process";
import {
  createHmac,
  randomBytes,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import type { Request, Response } from "express";
import {
  ffmpegBin,
  publicError,
  ytdlp,
  common,
  commonDownload,
  run,
} from "./process";
import { publicApiBaseUrl, contentDisposition } from "./streamDownload.service";
import {
  positiveNumber,
  resolveDownloadSize,
  type SizeMetadata,
} from "../../src/utils/fileSize";
import { embedMp3Metadata } from "./audioMetadata.service";

const SECRET =
  process.env.DOWNLOAD_SIGNING_SECRET ||
  randomBytes(32).toString("hex");

export type GenericKind = "video" | "audio";

export type GenericFormat = {
  id: string;
  height: number;
  width?: number;
  fps?: number | null;
  ext: string;
  codec: string;
  hasAudio: boolean;
  audioFormatId?: string;
  /** Direct media / HLS variant URL when different from page embed. */
  url?: string;
  estimatedSize: number | null;
  displaySize: number | null;
  sizeEstimated: boolean;
  resolution: string;
};

export type GenericAnalysis = {
  success: true;
  title: string;
  pageUrl: string;
  mediaUrl: string;
  duration: number;
  formats: GenericFormat[];
};

type GenericToken = {
  id: string;
  kind: GenericKind;
  mediaUrl: string;
  filename: string;
  contentType: string;
  title: string;
  artist?: string;
  pageUrl?: string;
  thumbnailUrl?: string;
  /** When true, extract via yt-dlp (embed page / HLS host). */
  viaYtDlp: boolean;
  formatId?: string;
  audioFormatId?: string;
  height?: number;
  exp: number;
  sig: string;
  state: "created" | "streaming" | "done" | "failed";
  bytesSent: number;
};

const tokens = new Map<string, GenericToken>();

function sign(id: string, exp: number): string {
  return createHmac("sha256", SECRET).update(`generic.${id}.${exp}`).digest("hex");
}

function verifySig(token: GenericToken): boolean {
  const expected = sign(token.id, token.exp);
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(token.sig));
  } catch {
    return false;
  }
}

function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function safeFilename(name: string, ext: string): string {
  const base =
    name
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
      .replace(/^\.+/, "")
      .trim()
      .slice(0, 120) || "media";
  const lower = base.toLowerCase();
  if (lower.endsWith(`.${ext}`)) return base;
  return `${base}.${ext}`;
}

function buildStreamUrl(id: string, sig: string): string {
  return new URL(
    `/api/download/generic/stream/${encodeURIComponent(id)}?sig=${encodeURIComponent(sig)}`,
    `${publicApiBaseUrl()}/`,
  ).toString();
}

function killTree(child: ChildProcess | null | undefined) {
  if (!child || child.killed) return;
  try {
    child.kill("SIGKILL");
  } catch {
    /* */
  }
}

function looksLikeDirectMedia(url: string): boolean {
  return /\.(mp4|webm|ogg|ogv|m4v|mov|mkv|mp3|m4a|aac|wav)(\?|#|$)/i.test(url);
}

function assertAllowedMediaUrl(mediaUrl: string): URL {
  if (!isHttpUrl(mediaUrl)) {
    throw new Error("MEDIA_URL_INVALID");
  }
  const parsed = new URL(mediaUrl);
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal"
  ) {
    if (process.env.ALLOW_LOCAL_GENERIC_MEDIA !== "1") {
      throw new Error("MEDIA_URL_BLOCKED");
    }
  }
  return parsed;
}

const analyzeCache = new Map<string, { data: GenericAnalysis; exp: number }>();

function isHlsUrl(url: string): boolean {
  return /\.m3u8(\?|#|$)/i.test(url) || /\/hls\//i.test(url);
}

function isProgressiveUrl(url: string): boolean {
  return /\.(mp4|webm|m4v|mov|mkv)(\?|#|$)/i.test(url);
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          process.env.YT_DLP_USER_AGENT ||
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "*/*",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Parse HLS master playlist → one format per height with variant URL. */
async function formatsFromHlsMaster(
  masterUrl: string,
): Promise<GenericFormat[]> {
  const text = await fetchText(masterUrl);
  if (!text || !/#EXT-X-STREAM-INF/i.test(text)) return [];
  const lines = text.split(/\r?\n/);
  const rows: { height: number; url: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || "";
    if (!line.startsWith("#EXT-X-STREAM-INF:")) continue;
    const m = /RESOLUTION=(\d+)x(\d+)/i.exec(line);
    const height = m ? Number(m[2]) : 0;
    const next = (lines[i + 1] || "").trim();
    if (!next || next.startsWith("#") || height <= 0) continue;
    try {
      rows.push({ height, url: new URL(next, masterUrl).toString() });
    } catch {
      /* */
    }
  }
  const byH = new Map<number, GenericFormat>();
  for (const row of rows.sort((a, b) => b.height - a.height)) {
    if (byH.has(row.height)) continue;
    byH.set(row.height, {
      id: `hls:${row.height}`,
      height: row.height,
      ext: "mp4",
      codec: "unknown",
      hasAudio: true,
      url: row.url,
      estimatedSize: null,
      displaySize: null,
      sizeEstimated: true,
      resolution: `${row.height}p`,
    });
  }
  return Array.from(byH.values()).sort((a, b) => b.height - a.height);
}

function formatsFromYtDlpRaw(raw: any, sourceUrl: string): GenericFormat[] {
  const audioStreams = (raw.formats || []).filter(
    (f: any) =>
      f.acodec &&
      f.acodec !== "none" &&
      f.vcodec === "none" &&
      !f.has_drm &&
      f.format_id,
  );

  const mapped: GenericFormat[] = (raw.formats || [])
    .filter(
      (f: any) =>
        f.vcodec &&
        f.vcodec !== "none" &&
        f.height &&
        f.format_id &&
        !f.has_drm,
    )
    .map((f: any) => {
      const hasAudio = !!f.acodec && f.acodec !== "none";
      const compatible =
        f.ext === "mp4"
          ? audioStreams.filter((a: any) => a.ext === "m4a")
          : audioStreams;
      const audio = (compatible.length ? compatible : audioStreams).at(-1);
      const source: SizeMetadata = {
        filesize: positiveNumber(f.filesize),
        filesizeApprox: positiveNumber(f.filesize_approx),
        videoBitrate: positiveNumber(f.vbr),
        audioBitrate: positiveNumber(f.abr),
        totalBitrate: positiveNumber(f.tbr),
      };
      const finalSize = resolveDownloadSize(
        source,
        raw.duration,
        hasAudio
          ? undefined
          : audio
            ? {
                filesize: positiveNumber(audio.filesize),
                filesizeApprox: positiveNumber(audio.filesize_approx),
                videoBitrate: undefined,
                audioBitrate: positiveNumber(audio.abr),
                totalBitrate: positiveNumber(audio.tbr),
              }
            : null,
      );
      return {
        id: String(f.format_id),
        height: Number(f.height),
        width: f.width ? Number(f.width) : undefined,
        fps: f.fps ? Number(f.fps) : null,
        ext: String(f.ext || "mp4"),
        codec: String(f.vcodec || "unknown"),
        hasAudio,
        audioFormatId: hasAudio
          ? undefined
          : audio?.format_id
            ? String(audio.format_id)
            : undefined,
        url: sourceUrl,
        ...finalSize,
        resolution: `${f.height}p`,
      } satisfies GenericFormat;
    })
    .sort(
      (a: GenericFormat, b: GenericFormat) =>
        b.height - a.height || (b.fps || 0) - (a.fps || 0),
    );

  const byHeight = new Map<number, GenericFormat>();
  for (const f of mapped) {
    const prev = byHeight.get(f.height);
    if (!prev) {
      byHeight.set(f.height, f);
      continue;
    }
    const score = (x: GenericFormat) =>
      Number(x.ext === "mp4") * 4 +
      Number(x.codec.startsWith("avc")) * 2 +
      Number(!!x.hasAudio);
    if (score(f) > score(prev)) byHeight.set(f.height, f);
  }
  return Array.from(byHeight.values()).sort((a, b) => b.height - a.height);
}

async function tryYtDlpAnalyze(url: string): Promise<{
  formats: GenericFormat[];
  title: string;
  duration: number;
} | null> {
  try {
    const raw = JSON.parse(
      await run(
        ytdlp(),
        [
          ...common(),
          "--dump-single-json",
          "--skip-download",
          "--no-playlist",
          "--",
          url,
        ],
        undefined,
        90_000,
      ),
    );
    if (raw?.is_live) return null;
    if (raw?.duration && raw.duration > 7200) return null;
    const formats = formatsFromYtDlpRaw(raw, url);
    if (!formats.length) return null;
    return {
      formats,
      title: String(raw.title || "").slice(0, 180),
      duration: Number(raw.duration) || 0,
    };
  } catch {
    return null;
  }
}

/**
 * List available qualities for an embed / host URL.
 * Tries yt-dlp, then HLS master parse, then progressive candidates.
 */
export async function analyzeGenericMedia(body: {
  mediaUrl: string;
  pageUrl?: string;
  title?: string;
  candidateUrls?: string[];
}): Promise<GenericAnalysis> {
  const mediaUrl = String(body.mediaUrl || "").trim();
  assertAllowedMediaUrl(mediaUrl);

  const candidates = [
    mediaUrl,
    ...(Array.isArray(body.candidateUrls) ? body.candidateUrls : []),
  ]
    .map((u) => String(u || "").trim())
    .filter(Boolean)
    .filter((u, i, arr) => arr.indexOf(u) === i)
    .slice(0, 12);

  const cacheKey = candidates.join("|");
  const cached = analyzeCache.get(cacheKey);
  if (cached && cached.exp > Date.now()) return cached.data;

  let title = String(body.title || "media").slice(0, 180);
  let duration = 0;
  let formats: GenericFormat[] = [];

  // 1) yt-dlp on each candidate (m3u8 / mp4 often works when embed page fails)
  for (const url of candidates) {
    try {
      assertAllowedMediaUrl(url);
    } catch {
      continue;
    }
    const hit = await tryYtDlpAnalyze(url);
    if (hit?.formats.length) {
      formats = hit.formats;
      if (hit.title) title = hit.title;
      duration = hit.duration;
      break;
    }
  }

  // 2) HLS master parse (explicit qualities)
  if (!formats.length) {
    for (const url of candidates) {
      if (!isHlsUrl(url)) continue;
      try {
        assertAllowedMediaUrl(url);
      } catch {
        continue;
      }
      const hls = await formatsFromHlsMaster(url);
      if (hls.length) {
        formats = hls;
        break;
      }
    }
  }

  // 3) Progressive files as single "best" / known height
  if (!formats.length) {
    for (const url of candidates) {
      if (!isProgressiveUrl(url)) continue;
      try {
        assertAllowedMediaUrl(url);
      } catch {
        continue;
      }
      formats = [
        {
          id: "progressive",
          height: 0,
          ext: "mp4",
          codec: "unknown",
          hasAudio: true,
          url,
          estimatedSize: null,
          displaySize: null,
          sizeEstimated: true,
          resolution: "best",
        },
      ];
      break;
    }
  }

  // 4) Last resort: any HLS media playlist
  if (!formats.length) {
    for (const url of candidates) {
      if (!isHlsUrl(url)) continue;
      try {
        assertAllowedMediaUrl(url);
      } catch {
        continue;
      }
      formats = [
        {
          id: "hls-best",
          height: 0,
          ext: "mp4",
          codec: "unknown",
          hasAudio: true,
          url,
          estimatedSize: null,
          displaySize: null,
          sizeEstimated: true,
          resolution: "best",
        },
      ];
      break;
    }
  }

  if (!formats.length) throw new Error("NO_FORMATS");

  // Prefer primary download URL = first format's url or mediaUrl
  const primary =
    formats.find((f) => f.url)?.url ||
    candidates.find((u) => isHlsUrl(u) || isProgressiveUrl(u)) ||
    mediaUrl;

  const data: GenericAnalysis = {
    success: true,
    title,
    pageUrl: String(body.pageUrl || mediaUrl),
    mediaUrl: primary,
    duration,
    formats,
  };

  if (analyzeCache.size >= 80) {
    analyzeCache.delete(analyzeCache.keys().next().value!);
  }
  analyzeCache.set(cacheKey, { data, exp: Date.now() + 5 * 60 * 1000 });
  return data;
}

function ytdlpFormatSelector(token: GenericToken): string {
  if (token.kind === "audio") return "bestaudio/best";
  if (token.formatId) {
    const id = token.formatId;
    if (token.audioFormatId) return `${id}+${token.audioFormatId}/${id}+bestaudio/${id}`;
    return `${id}+bestaudio/${id}/bv*+ba/b`;
  }
  if (token.height && token.height > 0) {
    const h = Math.round(token.height);
    return `bv*[height<=${h}]+ba/b[height<=${h}]/wv*[height<=${h}]+ba/b`;
  }
  return "bv*+ba/b";
}

/**
 * Prepare a signed stream for a direct HTTP(S) media URL or an embed page.
 * Video → MP4; Audio → MP3. Uses yt-dlp for non-direct (iframe host) URLs.
 */
export async function prepareGenericDownload(body: {
  mediaUrl: string;
  type: GenericKind;
  title?: string;
  artist?: string;
  pageUrl?: string;
  thumbnailUrl?: string;
  quality?: string;
  preferYtDlp?: boolean;
  formatId?: string;
  audioFormatId?: string;
  height?: number;
}): Promise<{
  success: true;
  jobId: string;
  downloadUrl: string;
  filename: string;
  mimeType: string;
  expiresAt: string;
}> {
  const mediaUrl = String(body.mediaUrl || "").trim();
  assertAllowedMediaUrl(mediaUrl);

  const kind = body.type;
  if (kind !== "video" && kind !== "audio") {
    throw new Error("TYPE_INVALID");
  }

  const title = String(body.title || "media").slice(0, 180);
  let artist = String(body.artist || "").trim().slice(0, 120);
  if (!artist && body.pageUrl) {
    try {
      artist = new URL(body.pageUrl).hostname.replace(/^www\./, "");
    } catch {
      /* */
    }
  }
  const filename =
    kind === "audio"
      ? artist
        ? safeFilename(`${artist} - ${title}`, "mp3")
        : safeFilename(title, "mp3")
      : safeFilename(title, "mp4");
  const contentType =
    kind === "audio" ? "audio/mpeg" : "video/mp4";

  const viaYtDlp =
    Boolean(body.preferYtDlp) ||
    Boolean(body.formatId) ||
    !looksLikeDirectMedia(mediaUrl);

  const id = randomUUID();
  const exp = Date.now() + 30 * 60 * 1000;
  const token: GenericToken = {
    id,
    kind,
    mediaUrl,
    filename,
    contentType,
    title,
    artist: artist || undefined,
    pageUrl: body.pageUrl ? String(body.pageUrl).slice(0, 500) : undefined,
    thumbnailUrl: body.thumbnailUrl
      ? String(body.thumbnailUrl).slice(0, 800)
      : undefined,
    viaYtDlp,
    formatId: body.formatId ? String(body.formatId) : undefined,
    audioFormatId: body.audioFormatId
      ? String(body.audioFormatId)
      : undefined,
    height:
      typeof body.height === "number" && body.height > 0
        ? Math.round(body.height)
        : undefined,
    exp,
    sig: sign(id, exp),
    state: "created",
    bytesSent: 0,
  };
  tokens.set(id, token);

  return {
    success: true,
    jobId: id,
    downloadUrl: buildStreamUrl(id, token.sig),
    filename,
    mimeType: contentType,
    expiresAt: new Date(exp).toISOString(),
  };
}

function sendError(res: Response, status: number, req?: Request): void {
  if (res.headersSent) return;
  const accept = String(req?.headers?.accept || "");
  if (accept.includes("application/json")) {
    res.status(status).json({
      success: false,
      error: "Source vidéo non prise en charge.",
    });
    return;
  }
  res.status(status).type("text/plain").end();
}

export async function handleGenericStream(
  id: string,
  sig: string | undefined,
  req: Request,
  res: Response,
): Promise<void> {
  const token = tokens.get(id);
  if (!token || token.exp < Date.now() || !verifySig(token)) {
    sendError(res, 410, req);
    return;
  }
  if (sig && sig !== token.sig) {
    sendError(res, 403, req);
    return;
  }
  if (token.state === "done" || token.state === "streaming") {
    sendError(res, 409, req);
    return;
  }

  if (req.method === "HEAD") {
    res.setHeader("Content-Type", token.contentType);
    res.setHeader("Content-Disposition", contentDisposition(token.filename));
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).end();
    return;
  }

  token.state = "streaming";
  const dir = await mkdtemp(join(tmpdir(), "nova-generic-"));
  const outPath = join(
    dir,
    token.kind === "audio" ? "out.mp3" : "out.mp4",
  );
  const outTpl = join(dir, "out.%(ext)s");

  const cleanup = () => {
    void rm(dir, { recursive: true, force: true });
  };
  req.on("aborted", cleanup);
  res.on("close", cleanup);

  try {
    let filePath = outPath;
    if (token.viaYtDlp) {
      const formatSel = ytdlpFormatSelector(token);
      if (token.kind === "audio") {
        await run(
          ytdlp(),
          [
            ...commonDownload(),
            "-f",
            formatSel,
            "-x",
            "--audio-format",
            "mp3",
            "--audio-quality",
            "0",
            "-o",
            outTpl,
            "--no-mtime",
            "--",
            token.mediaUrl,
          ],
          undefined,
          600_000,
        );
      } else {
        await run(
          ytdlp(),
          [
            ...commonDownload(),
            "-f",
            formatSel,
            "--merge-output-format",
            "mp4",
            "-o",
            outTpl,
            "--no-mtime",
            "--",
            token.mediaUrl,
          ],
          undefined,
          600_000,
        );
      }
      const files = await readdir(dir);
      const hit = files.find((f) => f.startsWith("out."));
      if (!hit) throw new Error("EMPTY_DOWNLOAD_RESPONSE");
      filePath = join(dir, hit);
    } else if (token.kind === "audio") {
      await runFfmpegToFile(
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          token.mediaUrl,
          "-vn",
          "-acodec",
          "libmp3lame",
          "-q:a",
          "0",
          "-y",
          outPath,
        ],
      );
    } else {
      // Prefer stream copy into MP4; fallback to re-encode if needed.
      try {
        await runFfmpegToFile(
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            token.mediaUrl,
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            "-y",
            outPath,
          ],
        );
      } catch {
        await runFfmpegToFile(
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            token.mediaUrl,
            "-c:v",
            "libx264",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
            "-y",
            outPath,
          ],
        );
      }
    }

    const { size } = await stat(filePath);
    if (!size || size < 256) throw new Error("EMPTY_DOWNLOAD_RESPONSE");

    if (token.kind === "audio" && filePath.toLowerCase().endsWith(".mp3")) {
      try {
        await embedMp3Metadata(filePath, {
          title: token.artist
            ? `${token.artist} - ${token.title}`
            : token.title,
          artist: token.artist || "Web",
          album: token.artist || "Web",
          comment: token.pageUrl || token.mediaUrl,
          thumbnailUrl: token.thumbnailUrl,
        });
      } catch (e) {
        console.warn("[GENERIC] metadata embed skipped", String(e).slice(-200));
      }
    }

    const { size: finalSize } = await stat(filePath);
    if (!finalSize || finalSize < 256) throw new Error("EMPTY_DOWNLOAD_RESPONSE");

    res.setHeader("Content-Type", token.contentType);
    res.setHeader("Content-Disposition", contentDisposition(token.filename));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Length", String(finalSize));
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.status(200);

    const stream = createReadStream(filePath);
    stream.on("data", (chunk: string | Buffer) => {
      token.bytesSent += Buffer.byteLength(chunk);
    });
    await pipeline(stream, res);
    token.state = "done";
  } catch (e) {
    console.error("[GENERIC STREAM]", publicError(e));
    token.state = "failed";
    if (!res.headersSent) sendError(res, 422, req);
    else if (!res.writableEnded) res.end();
  } finally {
    cleanup();
  }
}

function runFfmpegToFile(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin(), args, {
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env },
    });
    let err = "";
    child.stderr?.on("data", (b: Buffer) => {
      err = (err + b.toString()).slice(-8000);
    });
    const timer = setTimeout(() => {
      killTree(child);
      reject(new Error("PROCESS_TIMEOUT"));
    }, 600_000);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(err || `FFMPEG_FAILED:${code}`));
    });
  });
}

setInterval(() => {
  const now = Date.now();
  for (const [id, t] of tokens) if (t.exp < now) tokens.delete(id);
}, 60_000).unref();
