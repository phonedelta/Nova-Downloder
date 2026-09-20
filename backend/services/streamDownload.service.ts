import {
  createHmac,
  randomBytes,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import type { Request, Response } from "express";
import { analyze } from "./videoAnalyzer.service";
import { run, ytdlp, common, commonDownload, publicError, ffmpegBin } from "./process";
import { translateSrt } from "./translation.service";
import { safeName } from "./download.service";
import { embedMp3Metadata } from "./audioMetadata.service";
import { mkdtemp, readdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SECRET =
  process.env.DOWNLOAD_SIGNING_SECRET ||
  randomBytes(32).toString("hex");

/** Browser-reachable API origin (never Docker-internal hostnames). */
export function publicApiBaseUrl(reqHost?: {
  host?: string;
  proto?: string;
}): string {
  const railwayDomain =
    process.env.RAILWAY_PUBLIC_DOMAIN ||
    process.env.RAILWAY_STATIC_URL ||
    "";
  const railwayBase = railwayDomain
    ? railwayDomain.startsWith("http")
      ? railwayDomain.replace(/\/$/, "")
      : `https://${railwayDomain.replace(/\/$/, "")}`
    : "";

  const fromReq =
    reqHost?.host &&
    !/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(reqHost.host)
      ? `${reqHost.proto === "http" ? "http" : "https"}://${reqHost.host.replace(/\/$/, "")}`
      : "";

  const configured = (
    process.env.NOVA_PUBLIC_DOWNLOAD_BASE_URL ||
    process.env.PUBLIC_API_BASE_URL ||
    process.env.NOVA_API_BASE_URL ||
    ""
  )
    .trim()
    .replace(/\/$/, "");

  // Ignore placeholder / leftover localhost config on Railway
  const configuredOk =
    configured &&
    !/TON-SERVICE/i.test(configured) &&
    !(
      process.env.RAILWAY_ENVIRONMENT &&
      /127\.0\.0\.1|localhost/i.test(configured)
    )
      ? configured
      : "";

  const raw =
    configuredOk ||
    railwayBase ||
    fromReq ||
    `http://127.0.0.1:${process.env.PORT || "3001"}`;
  const base = raw.replace(/\/$/, "");
  try {
    const u = new URL(base);
    const host = u.hostname.toLowerCase();
    if (
      host === "backend" ||
      host === "api" ||
      host === "server" ||
      host.endsWith(".internal") ||
      /^10\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      throw new Error(`PUBLIC_API_BASE_URL is not browser-reachable: ${base}`);
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new Error(`PUBLIC_API_BASE_URL must be http(s): ${base}`);
    }
  } catch (e) {
    if (String(e).includes("PUBLIC_API_BASE_URL")) throw e;
    throw new Error(`Invalid PUBLIC_API_BASE_URL: ${base}`);
  }
  return base;
}

/** Absolute URL for chrome.downloads.download() — never a relative /api path. */
export function buildPublicDownloadUrl(
  id: string,
  sig: string,
  reqHost?: { host?: string; proto?: string },
): string {
  return new URL(
    `/api/download/stream/${encodeURIComponent(id)}?sig=${encodeURIComponent(sig)}`,
    `${publicApiBaseUrl(reqHost)}/`,
  ).toString();
}

export type StreamKind = "video" | "audio" | "subtitles";

export type StreamToken = {
  id: string;
  kind: StreamKind;
  videoUrl: string;
  formatId?: string;
  /** Requested video height — used for progressive fallback when DASH 403s */
  height?: number;
  bitrate?: string;
  language?: string;
  targetLanguage?: string;
  filename: string;
  contentType: string;
  requiresMerge: boolean;
  exp: number;
  sig: string;
  /** created | preparing | ready | streaming | done | failed */
  state: "created" | "preparing" | "ready" | "streaming" | "done" | "failed" | "paused";
  bytesSent: number;
  startedAt: number;
  /** UI-only estimate — never sent as Content-Length / never used as % truth */
  estimatedTotalBytes?: number | null;
  /** Exact final size when Content-Length was set (temp-file merge). */
  exactTotalBytes?: number | null;
  /** 0–100 while yt-dlp builds the file before Chrome transfer. */
  prepareProgress?: number | null;
  /** Absolute path to the finished file waiting for chrome.downloads. */
  readyFilePath?: string;
  readyDir?: string;
  /** Format spec to resume after pause (same temp dir). */
  resumeFormatSpec?: string;
  materializeError?: string;
  /** Soft-pause: keep temp files for resume. */
  paused?: boolean;
  /** True when user cancelled materialize. */
  cancelled?: boolean;
  /** ETA seconds from yt-dlp during prepare (not Chrome transfer). */
  prepareEtaSeconds?: number | null;
  speedBytesPerSecond?: number;
  lastByteAt?: number;
  lastSpeedAt?: number;
  lastSpeedBytes?: number;
  /** MP3 ID3 metadata (YouTube title / channel / cover). */
  mediaTitle?: string;
  mediaArtist?: string;
  mediaAlbum?: string;
  mediaComment?: string;
  mediaThumbnail?: string;
};

/** In-flight materialize promises keyed by token id. */
const materializePromises = new Map<string, Promise<void>>();
/** Kill hooks for in-flight yt-dlp/ffmpeg materialize processes. */
const materializeKillers = new Map<string, () => void>();

const tokens = new Map<string, StreamToken>();
let activeStreams = 0;
const MAX_STREAMS = Math.max(
  1,
  Number(process.env.MAX_CONCURRENT_DOWNLOADS || "4") || 4,
);

function sign(id: string, exp: number): string {
  return createHmac("sha256", SECRET).update(`${id}.${exp}`).digest("hex");
}

function verifySig(token: StreamToken): boolean {
  const expected = sign(token.id, token.exp);
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(token.sig));
  } catch {
    return false;
  }
}

export function contentDisposition(filename: string): string {
  const ascii =
    filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "") || "download";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function logDownload(event: string, fields: Record<string, unknown> = {}) {
  console.log(`[DOWNLOAD] ${event}`, {
    ts: new Date().toISOString(),
    ...fields,
  });
}

export async function prepareDownload(
  kind: StreamKind,
  body: {
    videoUrl: string;
    formatId?: string;
    bitrate?: string;
    language?: string;
    targetLanguage?: string;
  },
  reqHost?: { host?: string; proto?: string },
): Promise<{
  success: true;
  jobId: string;
  downloadUrl: string;
  filename: string;
  mimeType: string;
  estimatedSize: number | null;
  expiresAt: string;
  requiresMerge: boolean;
}> {
  if (activeStreams >= MAX_STREAMS) throw new Error("BUSY");

  console.log("[NOVA PREPARE] request received", { kind, formatId: body.formatId });

  const data = await analyze(body.videoUrl);
  let filename: string;
  let contentType: string;
  let requiresMerge = false;
  let formatId = body.formatId;
  let height: number | undefined;
  let bitrate = body.bitrate;
  let language = body.language;
  let targetLanguage = body.targetLanguage || "";

  if (kind === "video") {
    const f = data.formats.find((x) => x.id === body.formatId);
    if (!f) throw new Error("FORMAT_UNAVAILABLE");
    if (!f.hasAudio && !f.audioFormatId) throw new Error("NO_AUDIO");
    // Only exact filesize — never block on UI estimates
    if (f.filesize && f.filesize > 4 * 1024 ** 3) throw new Error("SIZE_LIMIT");
    requiresMerge = !f.hasAudio;
    height = f.height;
    const outExt = requiresMerge
      ? f.ext === "mp4"
        ? "mp4"
        : "mkv"
      : f.ext === "mp4"
        ? "mp4"
        : f.ext === "webm"
          ? "webm"
          : "mkv";
    filename = `${safeName(data.video.title)} - ${f.height}p.${outExt}`;
    contentType =
      outExt === "mp4"
        ? "video/mp4"
        : outExt === "webm"
          ? "video/webm"
          : "video/x-matroska";
  } else if (kind === "audio") {
    if (!["0", "320", "256", "192", "128"].includes(String(body.bitrate)))
      throw new Error("INVALID_BITRATE");
    const artist = String(data.video.channel || "").trim();
    const videoTitle = String(data.video.title || "audio").trim();
    // Audio only: "Chaîne - Titre vidéo" (never applied to video downloads)
    const trackTitle = artist ? `${artist} - ${videoTitle}` : videoTitle;
    filename = `${safeName(trackTitle)}.mp3`;
    contentType = "audio/mpeg";
    bitrate = String(body.bitrate);
  } else {
    const track = data.subtitles.find((t) => t.id === body.language);
    if (!track) throw new Error("SUBTITLE_UNAVAILABLE");
    filename = `${safeName(data.video.title)} - ${safeName(targetLanguage || track.language)}.srt`;
    contentType = "application/x-subrip; charset=utf-8";
    language = track.id;
  }

  const id = randomUUID();
  // Large merges (up to 4 GB) need a long-lived token before chrome.downloads.
  const exp = Date.now() + (kind === "video" ? 45 : 20) * 60 * 1000;
  const token: StreamToken = {
    id,
    kind,
    videoUrl: data.video.url,
    formatId,
    height,
    bitrate,
    language,
    targetLanguage,
    filename,
    contentType,
    requiresMerge,
    exp,
    sig: sign(id, exp),
    state: "created",
    bytesSent: 0,
    startedAt: Date.now(),
    estimatedTotalBytes: null,
    speedBytesPerSecond: 0,
    mediaTitle: (() => {
      const artist = String(data.video.channel || "").trim();
      const videoTitle = String(data.video.title || "audio").trim();
      const track = artist ? `${artist} - ${videoTitle}` : videoTitle;
      return track.slice(0, 200) || undefined;
    })(),
    mediaArtist: String(data.video.channel || "").slice(0, 200) || undefined,
    mediaAlbum: String(data.video.channel || "")
      .slice(0, 200) || undefined,
    mediaComment: data.video.url,
    mediaThumbnail:
      data.video.thumbnail ||
      (data.video.id
        ? `https://i.ytimg.com/vi/${data.video.id}/maxresdefault.jpg`
        : undefined),
  };
  tokens.set(id, token);

  const downloadUrl = buildPublicDownloadUrl(id, token.sig, reqHost);

  console.log("[NOVA PREPARE] videoId =", data.video.id);
  console.log("[NOVA PREPARE] formatId =", formatId);
  console.log("[NOVA PREPARE] token created", { id, exp: new Date(exp).toISOString() });
  console.log("[NOVA PREPARE] public download URL =", downloadUrl);

  logDownload("prepare ok", {
    downloadId: id,
    kind,
    requiresMerge,
    videoId: data.video.id,
    formatId,
    downloadUrl,
  });

  return {
    success: true,
    jobId: id,
    downloadUrl,
    filename,
    mimeType: contentType,
    estimatedSize: null,
    expiresAt: new Date(exp).toISOString(),
    requiresMerge,
  };
}

function killTree(child: ChildProcess | null | undefined) {
  if (!child || child.killed) return;
  try {
    child.kill("SIGKILL");
  } catch {
    /* already dead */
  }
}

/** Parse yt-dlp stdout/stderr into prepare progress, speed, and ETA. */
function applyYtDlpPrepareProgress(token: StreamToken, line: string) {
  const t = line.trim();
  if (!t) return;

  if (/\[Merger\]|Merging formats/i.test(t)) {
    token.prepareProgress = Math.max(token.prepareProgress || 0, 99);
    return;
  }

  const item = t.match(/Downloading item\s+(\d+)\s+of\s+(\d+)/i);
  if (item) {
    const cur = Math.max(1, Number(item[1]) || 1);
    const total = Math.max(1, Number(item[2]) || 1);
    (token as StreamToken & { _prepPhase?: number; _prepPhases?: number })._prepPhase =
      cur - 1;
    (token as StreamToken & { _prepPhases?: number })._prepPhases = total;
  }

  // e.g. "at  3.55MiB/s" or "at 512.00KiB/s"
  const speedMatch = t.match(
    /at\s+([\d.]+)\s*(KiB|MiB|GiB|KB|MB|GB|B)\/s/i,
  );
  if (speedMatch) {
    const n = parseFloat(speedMatch[1]);
    const unit = speedMatch[2].toUpperCase();
    let mult = 1;
    if (unit.startsWith("KI")) mult = 1024;
    else if (unit.startsWith("MI")) mult = 1024 ** 2;
    else if (unit.startsWith("GI")) mult = 1024 ** 3;
    else if (unit === "KB") mult = 1000;
    else if (unit === "MB") mult = 1000 ** 2;
    else if (unit === "GB") mult = 1000 ** 3;
    if (Number.isFinite(n) && n > 0) {
      token.speedBytesPerSecond = n * mult;
    }
  }

  // e.g. "ETA 00:13" or "ETA 01:02:03"
  const etaMatch = t.match(/ETA\s+(\d+):(\d+)(?::(\d+))?/i);
  if (etaMatch) {
    const a = Number(etaMatch[1]);
    const b = Number(etaMatch[2]);
    const c = etaMatch[3] != null ? Number(etaMatch[3]) : null;
    let seconds = 0;
    if (c != null) seconds = a * 3600 + b * 60 + c;
    else seconds = a * 60 + b;
    if (Number.isFinite(seconds) && seconds >= 0) {
      token.prepareEtaSeconds = seconds;
    }
  }

  const pctMatch = t.match(/\[download\]\s+([\d.]+)%/);
  if (!pctMatch) return;

  const pct = Math.min(100, Math.max(0, parseFloat(pctMatch[1])));
  const meta = token as StreamToken & {
    _prepPhase?: number;
    _prepPhases?: number;
    _prepLastPct?: number;
  };

  if (
    typeof meta._prepLastPct === "number" &&
    pct + 8 < meta._prepLastPct &&
    (meta._prepPhases || 1) > 1
  ) {
    meta._prepPhase = Math.min(
      (meta._prepPhases || 2) - 1,
      (meta._prepPhase || 0) + 1,
    );
  }
  meta._prepLastPct = pct;

  const phases = Math.max(1, meta._prepPhases || (token.requiresMerge ? 2 : 1));
  const phase = Math.min(phases - 1, meta._prepPhase || 0);
  const overall = ((phase + pct / 100) / phases) * 99;
  token.prepareProgress = Math.min(
    99,
    Math.max(token.prepareProgress || 0, overall),
  );
}

function attachStderr(
  child: ChildProcess,
  label: string,
): { text: () => string } {
  let buf = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    const s = chunk.toString();
    buf = (buf + s).slice(-12000);
    const line = s.trim();
    if (line) console.error(`[DOWNLOAD] [${label}]`, line.slice(0, 500));
  });
  return { text: () => buf };
}

function setDownloadHeaders(res: Response, token: StreamToken) {
  if (res.headersSent) return;
  // Never set Content-Length for live streams / unknown final size
  res.setHeader("Content-Type", token.contentType);
  res.setHeader("Content-Disposition", contentDisposition(token.filename));
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.status(200);
  console.log("[STREAM] first byte — headers committed", {
    downloadId: token.id,
    contentType: token.contentType,
    filename: token.filename,
  });
  logDownload("headers sent", {
    downloadId: token.id,
    contentType: token.contentType,
    filename: token.filename,
  });
}

function waitForFirstChunk(
  stream: NodeJS.ReadableStream,
  timeoutMs: number,
  downloadId: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("FIRST_BYTE_TIMEOUT"));
    }, timeoutMs);

    const onData = (chunk: Buffer | string) => {
      stream.pause();
      cleanup();
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      logDownload("first byte received from source", {
        downloadId,
        bytes: buf.length,
      });
      resolve(buf);
    };
    const onEnd = () => {
      cleanup();
      reject(new Error("EMPTY_DOWNLOAD_RESPONSE"));
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      clearTimeout(timer);
      stream.off("data", onData);
      stream.off("end", onEnd);
      stream.off("error", onError);
    };

    stream.once("data", onData);
    stream.once("end", onEnd);
    stream.once("error", onError);
    // Ensure flowing mode
    stream.resume();
  });
}

/**
 * Pipe a child process stdout to the HTTP response.
 * Headers are committed only after the first media byte.
 * Empty stdout → failure (never a silent 0-byte OK file).
 */
async function pipeStdoutToResponse(
  child: ChildProcess,
  req: Request,
  res: Response,
  token: StreamToken,
  label: string,
  firstByteTimeoutMs = 180_000,
): Promise<number> {
  if (!child.stdout) throw new Error("PROCESS_FAILED");

  const stderr = attachStderr(child, label);
  let bytesSent = 0;

  const abortIfNeeded = () => {
    if (!res.writableEnded) {
      logDownload("client aborted — killing process", { downloadId: token.id });
      killTree(child);
    }
  };
  req.on("aborted", abortIfNeeded);
  res.on("close", abortIfNeeded);

  const exitPromise = new Promise<number>((resolve, reject) => {
    child.on("error", (err) => reject(err));
    child.on("close", (code, signal) => {
      logDownload("process exit", {
        downloadId: token.id,
        label,
        code,
        signal,
        bytesStreamedSoFar: bytesSent,
      });
      resolve(code ?? 0);
    });
  });

  // Wait for real media before touching the HTTP response.
  // Prevents Chrome "0 octet — OK" when stdout ends empty or merge is still buffering.
  let first: Buffer;
  try {
    first = await waitForFirstChunk(
      child.stdout,
      firstByteTimeoutMs,
      token.id,
    );
  } catch (e) {
    killTree(child);
    logDownload("EMPTY_DOWNLOAD_RESPONSE", {
      downloadId: token.id,
      label,
      stderr: stderr.text().slice(-800),
      error: String(e),
    });
    throw new Error(
      String(e).includes("FIRST_BYTE_TIMEOUT")
        ? "FIRST_BYTE_TIMEOUT"
        : "EMPTY_DOWNLOAD_RESPONSE",
    );
  }

  token.state = "streaming";
  setDownloadHeaders(res, token);
  bytesSent += first.length;
  token.bytesSent = bytesSent;
  token.lastByteAt = Date.now();
  logDownload("first byte sent to browser", {
    downloadId: token.id,
    bytes: first.length,
  });
  console.log("[STREAM] first byte", { downloadId: token.id, bytes: first.length });

  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytesSent += chunk.length;
      token.bytesSent = bytesSent;
      const now = Date.now();
      if (token.lastByteAt && now > token.lastByteAt) {
        const dt = (now - token.lastByteAt) / 1000;
        if (dt > 0) {
          const sample = chunk.length / dt;
          const prev = token.speedBytesPerSecond || sample;
          token.speedBytesPerSecond = prev * 0.7 + sample * 0.3;
        }
      }
      token.lastByteAt = now;
      if (bytesSent % (2 * 1024 * 1024) < chunk.length) {
        console.log("[STREAM] bytes sent =", bytesSent, { downloadId: token.id });
      }
      cb(null, chunk);
    },
  });

  // Push the buffered first chunk, then the rest of stdout
  const rest = child.stdout;
  rest.pause();

  try {
    const writeFirst = new Promise<void>((resolve, reject) => {
      res.write(first, (err) => (err ? reject(err) : resolve()));
    });
    await writeFirst;
    rest.resume();
    const [, exitCode] = await Promise.all([
      pipeline(rest, counter, res),
      exitPromise,
    ]);

    if (bytesSent === 0) {
      logDownload("EMPTY_DOWNLOAD_RESPONSE", {
        downloadId: token.id,
        label,
        exitCode,
        stderr: stderr.text().slice(-800),
      });
      throw new Error("EMPTY_DOWNLOAD_RESPONSE");
    }

    logDownload("Total streamed", {
      downloadId: token.id,
      bytes: bytesSent,
      exitCode,
    });
    return bytesSent;
  } catch (e) {
    killTree(child);
    if (bytesSent === 0) {
      logDownload("EMPTY_DOWNLOAD_RESPONSE", {
        downloadId: token.id,
        label,
        stderr: stderr.text().slice(-800),
        error: String(e),
      });
      throw new Error("EMPTY_DOWNLOAD_RESPONSE");
    }
    if (!res.writableEnded) {
      try {
        res.destroy(e instanceof Error ? e : new Error(String(e)));
      } catch {
        /* */
      }
    }
    throw e;
  }
}

function spawnYtDlp(args: string[]): ChildProcess {
  // Do NOT use detached:true — it can break stdout piping (empty EOF → 0-byte downloads)
  return spawn(ytdlp(), args, {
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });
}

async function resolveVideoFormatSpecs(token: StreamToken): Promise<string[]> {
  const data = await analyze(token.videoUrl);
  const f = data.formats.find((x) => x.id === token.formatId);
  const height = token.height || f?.height || 360;

  const avcAtHeight = data.formats.find(
    (x) =>
      x.height === height &&
      !x.hasAudio &&
      x.ext === "mp4" &&
      (x.codec || "").startsWith("avc"),
  );
  const audioId =
    f?.audioFormatId ||
    avcAtHeight?.audioFormatId ||
    data.formats.find((x) => !x.hasAudio && x.height === height)?.audioFormatId;

  logDownload("source URL resolved via yt-dlp format", {
    downloadId: token.id,
    formatId: token.formatId,
    height,
    hasAudio: f?.hasAudio,
    audioFormatId: audioId || f?.audioFormatId,
    ext: f?.ext,
    avcAtHeight: avcAtHeight?.id,
  });

  const specs: string[] = [];
  if (f?.hasAudio && token.formatId) {
    specs.push(token.formatId);
  }
  if (!f?.hasAudio && token.formatId && (audioId || f?.audioFormatId)) {
    specs.push(`${token.formatId}+${audioId || f!.audioFormatId}`);
  }
  if (avcAtHeight?.id && (avcAtHeight.audioFormatId || audioId)) {
    const combo = `${avcAtHeight.id}+${avcAtHeight.audioFormatId || audioId}`;
    if (!specs.includes(combo)) specs.push(combo);
  }
  specs.push(
    `bestvideo[height=${height}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height=${height}]+bestaudio`,
  );
  specs.push(
    `bestvideo[height<=${height}][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[height<=${height}]+bestaudio`,
  );
  return specs;
}

async function streamVideo(
  token: StreamToken,
  req: Request,
  res: Response,
): Promise<void> {
  // Prefer a pre-built ready file (materialize → chrome.downloads).
  if (token.readyFilePath) {
    await streamReadyFile(token, req, res);
    return;
  }

  const data = await analyze(token.videoUrl);
  const f = data.formats.find((x) => x.id === token.formatId);
  const height = token.height || f?.height || 360;
  const specs = await resolveVideoFormatSpecs(token);

  const avcAtHeight = data.formats.find(
    (x) =>
      x.height === height &&
      !x.hasAudio &&
      x.ext === "mp4" &&
      (x.codec || "").startsWith("avc"),
  );
  const audioId =
    f?.audioFormatId ||
    avcAtHeight?.audioFormatId ||
    data.formats.find((x) => !x.hasAudio && x.height === height)?.audioFormatId;

  let lastErr: unknown;

  // 1) Prefer temp-file merge (yt-dlp + ffmpeg) — keeps selected height when DASH works
  for (const spec of specs) {
    if (res.headersSent) break;
    try {
      await streamViaTempFile(token, req, res, spec);
      return;
    } catch (e) {
      lastErr = e;
      logDownload("temp merge attempt failed", {
        downloadId: token.id,
        spec,
        error: String(e).slice(-400),
      });
      if (res.headersSent) throw e;
    }
  }

  // 2) Direct stdout attempts (progressive / simple formats)
  for (const spec of specs) {
    if (res.headersSent) break;
    try {
      const args = [
        ...commonDownload(),
        "--downloader",
        "native",
        "-f",
        spec,
        "-o",
        "-",
        "--no-part",
        "--no-mtime",
        "--",
        token.videoUrl,
      ];
      logDownload("process started", {
        downloadId: token.id,
        mode: "ytdlp-direct-stdout",
        formatSpec: spec,
      });
      const child = spawnYtDlp(args);
      await pipeStdoutToResponse(child, req, res, token, "yt-dlp");
      return;
    } catch (e) {
      lastErr = e;
      logDownload("format attempt failed — trying fallback", {
        downloadId: token.id,
        spec,
        error: String(e),
      });
      if (res.headersSent) throw e;
    }
  }

  // 3) FIFO merge at requested quality
  const mergeVideoId = avcAtHeight?.id || (f && !f.hasAudio ? f.id : undefined);
  const mergeAudioId = audioId || f?.audioFormatId;
  if (mergeVideoId && mergeAudioId && !res.headersSent) {
    try {
      await streamMergedViaFifo(token, req, res, mergeVideoId, mergeAudioId);
      return;
    } catch (e) {
      lastErr = e;
      logDownload("fifo merge failed", {
        downloadId: token.id,
        error: String(e),
      });
      if (res.headersSent) throw e;
    }
  }

  // 4) Progressive only if it can meet the height — never silently serve 360p as 1080p
  if (height <= 360) {
    try {
      const child = spawnYtDlp([
        ...commonDownload(),
        "--downloader",
        "native",
        "-f",
        "best[height<=360][acodec!=none]/18/best",
        "-o",
        "-",
        "--no-part",
        "--no-mtime",
        "--",
        token.videoUrl,
      ]);
      await pipeStdoutToResponse(child, req, res, token, "yt-dlp");
      return;
    } catch (e) {
      lastErr = e;
      if (res.headersSent) throw e;
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error("FORMAT_UNAVAILABLE");
}

/** Build the finished media file into token.readyFilePath (no HTTP yet). */
async function buildTempFile(
  token: StreamToken,
  formatSpec: string,
): Promise<{ outPath: string; dir: string; size: number }> {
  // Reuse paused temp dir so yt-dlp can continue partial downloads.
  const dir =
    token.readyDir && !token.cancelled
      ? token.readyDir
      : await mkdtemp(join(tmpdir(), "nova-out-"));
  const outIsMp4 = token.filename.endsWith(".mp4");
  const outPath = join(dir, outIsMp4 ? "out.mp4" : "out.mkv");
  token.readyDir = dir;
  token.resumeFormatSpec = formatSpec;

  try {
    logDownload("process started", {
      downloadId: token.id,
      mode: "ytdlp-materialize",
      formatSpec,
      resume: Boolean(token.paused),
    });
    token.paused = false;
    await run(
      ytdlp(),
      [
        ...commonDownload(),
        "--downloader",
        "native",
        "-f",
        formatSpec,
        "--merge-output-format",
        outIsMp4 ? "mp4" : "mkv",
        "-o",
        outPath,
        // Keep .part files so pause → resume continues (do NOT use --no-part).
        "--continue",
        "--no-mtime",
        "--",
        token.videoUrl,
      ],
      (line) => {
        const t = line.trim();
        if (t) console.error("[DOWNLOAD] [yt-dlp-merge]", t.slice(0, 300));
        applyYtDlpPrepareProgress(token, line);
      },
      600_000,
      {
        onStart: (kill) => {
          materializeKillers.set(token.id, kill);
        },
      },
    );

    if (token.cancelled) throw new Error("CANCELLED");
    if (token.paused) throw new Error("PAUSED");

    const { size } = await stat(outPath);
    if (!size || size < 8_192) throw new Error("EMPTY_DOWNLOAD_RESPONSE");
    return { outPath, dir, size };
  } catch (e) {
    // Keep temp dir on pause so resume can continue; wipe on hard failure/cancel.
    if (token.paused || String(e).includes("PAUSED")) {
      throw e;
    }
    if (token.cancelled || String(e).includes("CANCELLED")) {
      void rm(dir, { recursive: true, force: true });
      token.readyDir = undefined;
      throw e;
    }
    void rm(dir, { recursive: true, force: true });
    token.readyDir = undefined;
    throw e;
  } finally {
    materializeKillers.delete(token.id);
  }
}

async function streamReadyFile(
  token: StreamToken,
  req: Request,
  res: Response,
): Promise<void> {
  const outPath = token.readyFilePath;
  if (!outPath) throw new Error("READY_FILE_MISSING");

  const { size } =
    token.exactTotalBytes && token.exactTotalBytes > 0
      ? { size: token.exactTotalBytes }
      : await stat(outPath);

  const cleanup = () => {
    const dir = token.readyDir;
    token.readyFilePath = undefined;
    token.readyDir = undefined;
    if (dir) void rm(dir, { recursive: true, force: true });
  };
  req.on("aborted", cleanup);
  res.on("close", cleanup);

  const stream = createReadStream(outPath);
  token.state = "streaming";
  token.prepareProgress = 100;
  setDownloadHeaders(res, token);
  res.setHeader("Content-Length", String(size));
  token.exactTotalBytes = size;

  await new Promise<void>((resolve, reject) => {
    stream.on("error", reject);
    res.on("error", reject);
    stream.on("data", (chunk: string | Buffer) => {
      token.bytesSent += Buffer.byteLength(chunk);
      token.lastByteAt = Date.now();
    });
    stream.on("end", () => resolve());
    stream.pipe(res);
  });

  logDownload("Total streamed", {
    downloadId: token.id,
    bytes: token.bytesSent,
    mode: "ready-file",
  });
}

/**
 * Materialize video/audio to a temp file so chrome.downloads gets an immediate
 * Content-Length response (real 0–100% bar, no Save As hang).
 */
export function startMaterialize(
  id: string,
  sig: string | undefined,
): {
  jobId: string;
  state: string;
  prepareProgress: number | null;
  totalBytes: number | null;
  filename: string;
  error: string | null;
} {
  const token = tokens.get(id);
  if (!token || token.exp < Date.now() || !verifySig(token)) {
    throw new Error("TOKEN_INVALID");
  }
  if (sig && sig !== token.sig) throw new Error("TOKEN_INVALID");

  if (token.readyFilePath && token.state === "ready") {
    return {
      jobId: token.id,
      state: "ready",
      prepareProgress: 100,
      totalBytes: token.exactTotalBytes ?? null,
      filename: token.filename,
      error: null,
    };
  }

  if (token.state === "failed" && !token.paused) {
    return {
      jobId: token.id,
      state: "failed",
      prepareProgress: token.prepareProgress ?? null,
      totalBytes: null,
      filename: token.filename,
      error: token.materializeError || "MATERIALIZE_FAILED",
    };
  }

  if (token.kind === "subtitles") {
    // Tiny — stream on demand; mark ready without a temp file.
    token.state = "ready";
    token.prepareProgress = 100;
    return {
      jobId: token.id,
      state: "ready",
      prepareProgress: 100,
      totalBytes: null,
      filename: token.filename,
      error: null,
    };
  }

  if (!materializePromises.has(id)) {
    token.cancelled = false;
    token.paused = false;
    token.state = "preparing";
    token.prepareProgress = token.prepareProgress ?? 0;
    token.materializeError = undefined;
    const promise = doMaterialize(token).finally(() => {
      materializePromises.delete(id);
    });
    materializePromises.set(id, promise);
  }

  return {
    jobId: token.id,
    state: token.state === "ready" ? "ready" : "preparing",
    prepareProgress:
      typeof token.prepareProgress === "number" ? token.prepareProgress : 0,
    totalBytes: token.exactTotalBytes ?? null,
    filename: token.filename,
    error: null,
  };
}

/** Pause materialize — kill process but keep partial files for resume. */
export function pauseMaterialize(
  id: string,
  sig: string | undefined,
): { ok: boolean; state: string; prepareProgress: number | null } {
  const token = tokens.get(id);
  if (!token || token.exp < Date.now() || !verifySig(token)) {
    throw new Error("TOKEN_INVALID");
  }
  if (sig && sig !== token.sig) throw new Error("TOKEN_INVALID");

  token.paused = true;
  token.cancelled = false;
  materializeKillers.get(id)?.();
  materializeKillers.delete(id);
  token.state = "paused";
  token.speedBytesPerSecond = 0;
  // Keep prepareEtaSeconds / prepareProgress / readyDir for resume.

  logDownload("materialize paused", {
    downloadId: id,
    progress: token.prepareProgress,
    hasDir: Boolean(token.readyDir),
  });
  return {
    ok: true,
    state: "paused",
    prepareProgress:
      typeof token.prepareProgress === "number" ? token.prepareProgress : null,
  };
}

/** Abort an in-flight materialize (user cancel — deletes temp files). */
export function cancelMaterialize(
  id: string,
  sig: string | undefined,
): { ok: boolean; state: string } {
  const token = tokens.get(id);
  if (!token || token.exp < Date.now() || !verifySig(token)) {
    throw new Error("TOKEN_INVALID");
  }
  if (sig && sig !== token.sig) throw new Error("TOKEN_INVALID");

  token.cancelled = true;
  token.paused = false;
  token.materializeError = "CANCELLED";
  materializeKillers.get(id)?.();
  materializeKillers.delete(id);

  if (token.readyDir) {
    void rm(token.readyDir, { recursive: true, force: true });
  }
  token.readyFilePath = undefined;
  token.readyDir = undefined;
  token.resumeFormatSpec = undefined;
  token.state = "failed";
  token.speedBytesPerSecond = 0;
  token.prepareEtaSeconds = null;

  logDownload("materialize cancelled", { downloadId: id });
  return { ok: true, state: "cancelled" };
}

async function doMaterialize(token: StreamToken): Promise<void> {
  try {
    if (token.cancelled) throw new Error("CANCELLED");
    if (token.kind === "audio") {
      await materializeAudio(token);
      return;
    }

    // Prefer the format we already started downloading (resume).
    const specs = token.resumeFormatSpec
      ? [
          token.resumeFormatSpec,
          ...(await resolveVideoFormatSpecs(token)).filter(
            (s) => s !== token.resumeFormatSpec,
          ),
        ]
      : await resolveVideoFormatSpecs(token);

    let lastErr: unknown;
    for (const spec of specs) {
      if (token.cancelled) throw new Error("CANCELLED");
      if (token.paused) throw new Error("PAUSED");
      try {
        const built = await buildTempFile(token, spec);
        if (token.cancelled) {
          void rm(built.dir, { recursive: true, force: true });
          throw new Error("CANCELLED");
        }
        if (token.paused) throw new Error("PAUSED");
        token.readyFilePath = built.outPath;
        token.readyDir = built.dir;
        token.exactTotalBytes = built.size;
        token.estimatedTotalBytes = built.size;
        token.prepareProgress = 100;
        token.state = "ready";
        logDownload("materialize ready", {
          downloadId: token.id,
          bytes: built.size,
          spec,
        });
        return;
      } catch (e) {
        lastErr = e;
        if (
          String(e).includes("PAUSED") ||
          token.paused ||
          String(e).includes("CANCELLED") ||
          token.cancelled
        ) {
          throw e;
        }
        // Failed format — wipe dir so next spec starts clean.
        if (token.readyDir) {
          void rm(token.readyDir, { recursive: true, force: true });
          token.readyDir = undefined;
          token.resumeFormatSpec = undefined;
        }
        logDownload("materialize attempt failed", {
          downloadId: token.id,
          spec,
          error: String(e).slice(-400),
        });
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error("FORMAT_UNAVAILABLE");
  } catch (e) {
    if (token.paused || String(e).includes("PAUSED")) {
      token.state = "paused";
      token.materializeError = undefined;
      logDownload("materialize paused ok", { downloadId: token.id });
      return;
    }
    token.state = "failed";
    token.materializeError = token.cancelled
      ? "CANCELLED"
      : publicError(e);
    logDownload("materialize failed", {
      downloadId: token.id,
      error: String(e).slice(-400),
    });
  } finally {
    materializeKillers.delete(token.id);
  }
}

async function materializeAudio(token: StreamToken): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "nova-aud-"));
  const outPath = join(dir, "out.mp3");
  const formatSpecs = [
    "bestaudio[acodec!=none]/best[acodec!=none]/18/best",
    "18/best",
  ];
  const quality =
    String(token.bitrate) === "0" ? null : `${token.bitrate}k`;

  let lastErr: unknown;
  try {
    token.state = "preparing";
    token.prepareProgress = 0;

    for (const formatSpec of formatSpecs) {
      try {
        await new Promise<void>((resolve, reject) => {
          const ytdlpProc = spawnYtDlp([
            ...commonDownload(),
            "--downloader",
            "native",
            "-f",
            formatSpec,
            "-o",
            "-",
            "--no-part",
            "--no-mtime",
            "--",
            token.videoUrl,
          ]);
          const ffmpeg = spawn(
            ffmpegBin(),
            [
              "-hide_banner",
              "-loglevel",
              "error",
              "-i",
              "pipe:0",
              "-vn",
              "-acodec",
              "libmp3lame",
              ...(quality ? ["-b:a", quality] : ["-q:a", "0"]),
              "-f",
              "mp3",
              outPath,
            ],
            {
              shell: false,
              stdio: ["pipe", "ignore", "pipe"],
              env: { ...process.env },
            },
          );
          attachStderr(ytdlpProc, "yt-dlp-audio-mat");
          const ffErr = attachStderr(ffmpeg, "ffmpeg-mp3-mat");
          if (!ytdlpProc.stdout || !ffmpeg.stdin) {
            killTree(ytdlpProc);
            killTree(ffmpeg);
            reject(new Error("PROCESS_FAILED"));
            return;
          }
          materializeKillers.set(token.id, () => {
            killTree(ytdlpProc);
            killTree(ffmpeg);
          });
          ytdlpProc.stdout.pipe(ffmpeg.stdin);
          ytdlpProc.stderr?.on("data", (chunk: Buffer) => {
            applyYtDlpPrepareProgress(token, chunk.toString());
          });
          ffmpeg.on("close", (code) => {
            materializeKillers.delete(token.id);
            if (token.cancelled) {
              reject(new Error("CANCELLED"));
              return;
            }
            if (code && code !== 0) {
              reject(
                new Error(
                  `AUDIO_ENCODE_FAILED:${code}:${ffErr.text().slice(-200)}`,
                ),
              );
            } else resolve();
          });
          ytdlpProc.on("error", reject);
          ffmpeg.on("error", reject);
          ytdlpProc.on("close", () => {
            try {
              ffmpeg.stdin?.end();
            } catch {
              /* */
            }
          });
        });

        if (token.cancelled) throw new Error("CANCELLED");

        const { size: rawSize } = await stat(outPath);
        if (!rawSize || rawSize < 4_096) throw new Error("EMPTY_DOWNLOAD_RESPONSE");

        try {
          await embedMp3Metadata(outPath, {
            title: token.mediaTitle || token.filename.replace(/\.mp3$/i, ""),
            artist: token.mediaArtist || "YouTube",
            album: token.mediaAlbum || token.mediaArtist || "YouTube",
            comment: token.mediaComment || token.videoUrl,
            thumbnailUrl: token.mediaThumbnail,
          });
        } catch (metaErr) {
          logDownload("audio metadata embed skipped", {
            downloadId: token.id,
            error: String(metaErr).slice(-300),
          });
        }

        const { size } = await stat(outPath);
        if (!size || size < 4_096) throw new Error("EMPTY_DOWNLOAD_RESPONSE");
        token.readyFilePath = outPath;
        token.readyDir = dir;
        token.exactTotalBytes = size;
        token.estimatedTotalBytes = size;
        token.prepareProgress = 100;
        token.state = "ready";
        return;
      } catch (e) {
        lastErr = e;
        logDownload("audio materialize attempt failed", {
          downloadId: token.id,
          formatSpec,
          error: String(e).slice(-400),
        });
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error("EMPTY_DOWNLOAD_RESPONSE");
  } catch (e) {
    void rm(dir, { recursive: true, force: true });
    throw e;
  }
}

/** Download+merge to a temp file, then stream the finished file to the client. */
async function streamViaTempFile(
  token: StreamToken,
  req: Request,
  res: Response,
  formatSpec: string,
): Promise<void> {
  if (token.readyFilePath) {
    await streamReadyFile(token, req, res);
    return;
  }

  const built = await buildTempFile(token, formatSpec);
  token.readyFilePath = built.outPath;
  token.readyDir = built.dir;
  token.exactTotalBytes = built.size;
  await streamReadyFile(token, req, res);
}

async function streamMergedViaFifo(
  token: StreamToken,
  req: Request,
  res: Response,
  videoFormatId: string,
  audioFormatId: string,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "nova-mux-"));
  const children: ChildProcess[] = [];
  const outIsMp4 = token.filename.endsWith(".mp4");

  const cleanup = () => {
    for (const c of children) killTree(c);
    void rm(dir, { recursive: true, force: true });
  };

  const abortIfNeeded = () => {
    if (!res.writableEnded) {
      logDownload("client aborted — killing merge", { downloadId: token.id });
      cleanup();
    }
  };
  req.on("aborted", abortIfNeeded);
  res.on("close", abortIfNeeded);

  // Prefer clients that still yield progressive HTTPS media without cookies
  const ytdlpDownloadArgs = (extra: string[]) => {
    return [
      ...commonDownload(),
      "--downloader",
      "native",
      "--no-part",
      "--no-mtime",
      ...extra,
    ];
  };

  try {
    logDownload("process started", {
      downloadId: token.id,
      mode: "audio-first then video-pipe|ffmpeg-mux",
      videoFormatId,
      audioFormatId,
    });

    const audioAttempts: { spec: string; extract?: boolean }[] = [
      { spec: audioFormatId },
      { spec: "bestaudio[ext=m4a]/bestaudio" },
      { spec: "bestaudio/best" },
      // Progressive format 18 streams successfully — extract its audio track
      { spec: "18", extract: true },
    ];

    let audioFile: string | null = null;
    let lastAudioErr: unknown;
    for (const attempt of audioAttempts) {
      try {
        if (attempt.extract) {
          // yt-dlp -f 18 -o - | ffmpeg -vn → m4a (avoids DASH 403 + broken -x path)
          const audioOut = join(dir, "audio.m4a");
          const vProc = spawnYtDlp(
            ytdlpDownloadArgs(["-f", attempt.spec, "-o", "-", "--", token.videoUrl]),
          );
          const ffExtract = spawn(
            ffmpegBin(),
            [
              "-hide_banner",
              "-loglevel",
              "error",
              "-i",
              "pipe:0",
              "-vn",
              "-acodec",
              "copy",
              "-f",
              "ipod",
              audioOut,
            ],
            {
              shell: false,
              stdio: ["pipe", "ignore", "pipe"],
              env: { ...process.env },
            },
          );
          attachStderr(vProc, "yt-dlp-prog");
          attachStderr(ffExtract, "ffmpeg-extract-audio");
          if (!vProc.stdout || !ffExtract.stdin)
            throw new Error("PROCESS_FAILED");
          vProc.stdout.pipe(ffExtract.stdin);
          await new Promise<void>((resolve, reject) => {
            ffExtract.on("error", reject);
            vProc.on("error", reject);
            ffExtract.on("close", (code) => {
              if (code && code !== 0)
                reject(new Error(`AUDIO_EXTRACT_FAILED:${code}`));
              else resolve();
            });
            vProc.on("close", (code) => {
              try {
                ffExtract.stdin?.end();
              } catch {
                /* */
              }
              if (code && code !== 0)
                reject(new Error(`PROG_DOWNLOAD_FAILED:${code}`));
            });
          });
          const files = await readdir(dir);
          const hit = files.find((f) => f === "audio.m4a");
          if (hit) {
            audioFile = join(dir, hit);
            logDownload("audio file ready", {
              downloadId: token.id,
              audioFile,
              spec: attempt.spec,
              extract: true,
            });
            break;
          }
          throw new Error("AUDIO_EXTRACT_MISSING");
        }

        const outTpl = join(dir, "audio.%(ext)s");
        await run(
          ytdlp(),
          ytdlpDownloadArgs([
            "-f",
            attempt.spec,
            "-o",
            outTpl,
            "--",
            token.videoUrl,
          ]),
          (line) => {
            if (line.trim())
              console.error(
                `[DOWNLOAD] [yt-dlp-audio]`,
                line.trim().slice(0, 300),
              );
          },
          180_000,
        );
        const files = await readdir(dir);
        const hit = files.find(
          (f) =>
            f.startsWith("audio.") ||
            f.endsWith(".m4a") ||
            f.endsWith(".webm") ||
            f.endsWith(".opus"),
        );
        if (hit) {
          audioFile = join(dir, hit);
          logDownload("audio file ready", {
            downloadId: token.id,
            audioFile,
            spec: attempt.spec,
          });
          break;
        }
      } catch (e) {
        lastAudioErr = e;
        logDownload("audio attempt failed", {
          downloadId: token.id,
          spec: attempt.spec,
          error: String(e).slice(-400),
        });
      }
    }
    if (!audioFile) {
      throw lastAudioErr || new Error("NO_AUDIO");
    }

    const vProc = spawnYtDlp(
      ytdlpDownloadArgs([
        "-f",
        videoFormatId,
        "-o",
        "-",
        "--",
        token.videoUrl,
      ]),
    );
    children.push(vProc);
    attachStderr(vProc, "yt-dlp-video");

    const ffArgs = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-i",
      audioFile,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0?",
      "-c",
      "copy",
      ...(outIsMp4
        ? [
            "-movflags",
            "frag_keyframe+empty_moov+default_base_moof",
            "-f",
            "mp4",
          ]
        : ["-f", "matroska"]),
      "pipe:1",
    ];
    const ffmpeg = spawn(ffmpegBin(), ffArgs, {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
    children.push(ffmpeg);
    attachStderr(ffmpeg, "ffmpeg-mux");

    if (!vProc.stdout || !ffmpeg.stdin) throw new Error("PROCESS_FAILED");

    vProc.stdout.on("error", (err) => {
      logDownload("video stdout error", {
        downloadId: token.id,
        error: String(err),
      });
    });
    ffmpeg.stdin.on("error", (err) => {
      logDownload("ffmpeg stdin error", {
        downloadId: token.id,
        error: String(err),
      });
    });

    vProc.stdout.pipe(ffmpeg.stdin);
    vProc.on("close", (code) => {
      try {
        ffmpeg.stdin?.end();
      } catch {
        /* */
      }
      if (code && code !== 0)
        logDownload("yt-dlp video exit", { downloadId: token.id, code });
    });

    await pipeStdoutToResponse(
      ffmpeg,
      req,
      res,
      token,
      "ffmpeg-mux",
      180_000,
    );
  } finally {
    cleanup();
  }
}

async function streamAudio(
  token: StreamToken,
  req: Request,
  res: Response,
): Promise<void> {
  // Always materialize first so ID3 tags + cover art are in the file
  // (site browser download and extension share this path).
  if (!token.readyFilePath) {
    await materializeAudio(token);
  }
  if (!token.readyFilePath) {
    throw new Error("EMPTY_DOWNLOAD_RESPONSE");
  }
  await streamReadyFile(token, req, res);
}

async function streamSubtitles(
  token: StreamToken,
  req: Request,
  res: Response,
): Promise<void> {
  const data = await analyze(token.videoUrl);
  const track = data.subtitles.find((t) => t.id === token.language);
  if (!track) throw new Error("SUBTITLE_UNAVAILABLE");

  const dir = await mkdtemp(join(tmpdir(), "nova-sub-"));
  const cleanup = () => {
    void rm(dir, { recursive: true, force: true });
  };
  req.on("aborted", cleanup);

  try {
    logDownload("process started", {
      downloadId: token.id,
      mode: "subtitles",
      language: track.language,
    });
    await run(
      ytdlp(),
      [
        ...commonDownload(),
        "--skip-download",
        track.automatic ? "--write-auto-subs" : "--write-subs",
        "--sub-langs",
        track.language,
        "--sub-format",
        "srt/vtt/best",
        "--convert-subs",
        "srt",
        "-o",
        join(dir, "sub.%(ext)s"),
        "--",
        token.videoUrl,
      ],
      undefined,
      120000,
    );
    const files = await readdir(dir);
    const file = files.find((f) => f.endsWith(".srt"));
    if (!file) throw new Error("SUBTITLE_UNAVAILABLE");
    let text = await readFile(join(dir, file), "utf8");
    if (token.targetLanguage) {
      text = await translateSrt(text, track.language, token.targetLanguage);
      await writeFile(join(dir, file), text, "utf8");
    }
    if (!text.trim()) throw new Error("EMPTY_DOWNLOAD_RESPONSE");

    token.state = "streaming";
    setDownloadHeaders(res, token);
    logDownload("first byte sent to browser", {
      downloadId: token.id,
      bytes: Buffer.byteLength(text),
      mode: "srt",
    });
    res.end(text);
    logDownload("Total streamed", {
      downloadId: token.id,
      bytes: Buffer.byteLength(text),
    });
  } finally {
    cleanup();
  }
}

/**
 * Stream errors for chrome.downloads must NOT return a JSON body:
 * Chrome would save it as 2160p.json (~80 bytes) and mark state=complete.
 * Empty body + error status → interrupted / failed download, no .json file.
 * curl/API clients that Accept: application/json still get JSON.
 */
function sendStreamJsonError(
  res: Response,
  status: number,
  error: string,
  req?: Request,
): void {
  if (res.headersSent) return;
  res.removeHeader("Content-Disposition");
  const accept = String(req?.headers?.accept || "");
  const wantsJson = accept.includes("application/json");
  console.log("[NOVA STREAM] error", { status, error, wantsJson });
  if (wantsJson) {
    res.status(status).type("application/json").json({
      success: false,
      error,
      code: "SOURCE_UNAVAILABLE",
    });
    return;
  }
  // Chrome Downloads / curl without Accept:json — empty body
  res.status(status).type("text/plain").end();
}

export async function handleStream(
  id: string,
  sig: string | undefined,
  req: Request,
  res: Response,
): Promise<void> {
  console.log("[NOVA STREAM] request received", {
    id,
    method: req.method,
    hasSig: Boolean(sig),
  });
  logDownload("Request received", { downloadId: id, method: req.method });

  const token = tokens.get(id);
  if (!token || token.exp < Date.now() || !verifySig(token)) {
    sendStreamJsonError(
      res,
      410,
      "Download token invalid or expired",
      req,
    );
    return;
  }
  if (sig && sig !== token.sig) {
    sendStreamJsonError(res, 403, "Download token invalid or expired", req);
    return;
  }
  if (token.state === "done") {
    sendStreamJsonError(
      res,
      410,
      "Download token invalid or expired",
      req,
    );
    return;
  }
  if (token.state === "streaming" && req.method !== "HEAD") {
    sendStreamJsonError(
      res,
      409,
      "Ce téléchargement est déjà en cours.",
      req,
    );
    return;
  }
  if (activeStreams >= MAX_STREAMS && req.method !== "HEAD") {
    sendStreamJsonError(
      res,
      429,
      "Le serveur est occupé. Veuillez réessayer dans un instant.",
      req,
    );
    return;
  }

  console.log("[NOVA STREAM] token valid", {
    id,
    kind: token.kind,
    formatId: token.formatId,
  });
  logDownload("token validated", {
    downloadId: id,
    kind: token.kind,
    format: token.formatId,
    videoUrl: token.videoUrl,
  });

  // Chrome / Edge may probe with HEAD before the real GET.
  // Never start yt-dlp/FFmpeg or consume the token on HEAD.
  if (req.method === "HEAD") {
    res.setHeader("Content-Type", token.contentType);
    res.setHeader("Content-Disposition", contentDisposition(token.filename));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    if (token.exactTotalBytes && token.exactTotalBytes > 0) {
      res.setHeader("Content-Length", String(token.exactTotalBytes));
    }
    res.status(200).end();
    console.log("[NOVA STREAM] HEAD probe answered — token still valid");
    return;
  }

  // If materialize is still running, wait so Chrome gets an immediate file.
  const inflight = materializePromises.get(id);
  if (inflight) {
    try {
      await inflight;
    } catch {
      /* doMaterialize sets token.state */
    }
  }
  if (token.state === "failed") {
    sendStreamJsonError(
      res,
      422,
      token.materializeError || "La préparation a échoué.",
      req,
    );
    return;
  }

  activeStreams++;
  const started = Date.now();
  let completedOk = false;

  try {
    // Prefer ready file (materialize completed) — immediate Content-Length.
    if (token.readyFilePath) {
      await streamReadyFile(token, req, res);
    } else if (token.kind === "video") await streamVideo(token, req, res);
    else if (token.kind === "audio") await streamAudio(token, req, res);
    else await streamSubtitles(token, req, res);

    completedOk = true;
    token.state = "done";
    console.log("[NOVA STREAM] completed", {
      id,
      bytesSent: token.bytesSent,
      ms: Date.now() - started,
    });
    logDownload("response closed", {
      downloadId: id,
      ms: Date.now() - started,
      aborted: req.aborted,
    });
  } catch (e) {
    const msg = publicError(e);
    logDownload("stream error", {
      downloadId: id,
      error: String(e),
      public: msg,
      headersSent: res.headersSent,
    });
    console.log("[NOVA STREAM] error", String(e));
    if (!res.headersSent) {
      const status =
        String(e).includes("EMPTY_DOWNLOAD_RESPONSE") ||
        String(e).includes("PROCESS_FAILED") ||
        String(e).includes("FIRST_BYTE_TIMEOUT")
          ? 502
          : 422;
      if (token.state === "streaming") token.state = "created";
      sendStreamJsonError(
        res,
        status,
        String(e).includes("EMPTY_DOWNLOAD_RESPONSE")
          ? "Le téléchargement n’a produit aucune donnée. Réessayez."
          : String(e).includes("FIRST_BYTE_TIMEOUT")
            ? "Le serveur n’a reçu aucune donnée vidéo à temps. Réessayez."
            : msg,
        req,
      );
    } else if (!res.writableEnded) {
      try {
        res.destroy(e instanceof Error ? e : new Error(String(e)));
      } catch {
        /* */
      }
    }
  } finally {
    activeStreams--;
    if (completedOk) {
      token.state = "done";
    } else if (!res.headersSent) {
      token.state = "created";
    } else {
      token.state = "failed";
    }
  }
}

export function getStreamStatus(id: string): {
  jobId: string;
  state: string;
  bytesSent: number;
  totalBytes: number | null;
  totalBytesExact: boolean;
  estimatedTotalBytes: number | null;
  prepareProgress: number | null;
  expectedType: string;
  speedBytesPerSecond: number;
  etaSeconds: number | null;
  filename: string;
  error: { code: string; message: string } | null;
} | null {
  const token = tokens.get(id);
  if (!token) return null;

  const exact =
    typeof token.exactTotalBytes === "number" && token.exactTotalBytes > 0
      ? token.exactTotalBytes
      : null;
  const estimated =
    typeof token.estimatedTotalBytes === "number" &&
    token.estimatedTotalBytes > 0
      ? token.estimatedTotalBytes
      : null;

  // Real download speed from bytes actually written to the HTTP response
  // (skip while preparing — speed comes from yt-dlp lines instead).
  const now = Date.now();
  let speed = token.speedBytesPerSecond || 0;
  if (
    token.state === "streaming" &&
    token.lastSpeedAt &&
    token.lastSpeedBytes != null &&
    now > token.lastSpeedAt
  ) {
    const dt = (now - token.lastSpeedAt) / 1000;
    if (dt > 0) {
      const sample = Math.max(0, token.bytesSent - token.lastSpeedBytes) / dt;
      speed = speed > 0 ? speed * 0.7 + sample * 0.3 : sample;
      token.speedBytesPerSecond = speed;
    }
  }
  if (token.state === "streaming") {
    token.lastSpeedAt = now;
    token.lastSpeedBytes = token.bytesSent;
  }

  let state: string;
  let error: { code: string; message: string } | null = null;
  if (token.cancelled || token.materializeError === "CANCELLED") {
    state = "cancelled";
    error = {
      code: "CANCELLED",
      message: "Téléchargement annulé.",
    };
  } else if (token.state === "paused" || token.paused) state = "paused";
  else if (token.state === "created") state = "preparing";
  else if (token.state === "preparing") state = "preparing";
  else if (token.state === "ready") state = "ready";
  else if (token.state === "streaming") state = "downloading";
  else if (token.state === "done") {
    if (token.bytesSent <= 0) {
      state = "failed";
      error = {
        code: "EMPTY_DOWNLOAD",
        message: "Le téléchargement n’a produit aucune donnée.",
      };
    } else state = "completed";
  } else {
    state = "failed";
    error = {
      code: "STREAM_FAILED",
      message: token.materializeError || "Le stream a échoué.",
    };
  }

  let etaSeconds: number | null = null;
  if (state === "preparing") {
    etaSeconds =
      typeof token.prepareEtaSeconds === "number"
        ? token.prepareEtaSeconds
        : null;
  } else if (exact != null && state === "downloading" && speed > 256) {
    etaSeconds = Math.max(0, exact - token.bytesSent) / speed;
  }

  const prepareProgress =
    typeof token.prepareProgress === "number" &&
    Number.isFinite(token.prepareProgress)
      ? Math.min(100, Math.max(0, token.prepareProgress))
      : state === "ready"
        ? 100
        : null;

  return {
    jobId: token.id,
    state,
    bytesSent: token.bytesSent,
    totalBytes: exact,
    totalBytesExact: exact != null,
    estimatedTotalBytes: estimated,
    prepareProgress,
    expectedType: token.contentType,
    speedBytesPerSecond: speed,
    etaSeconds,
    filename: token.filename,
    error,
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [id, t] of tokens) if (t.exp < now) tokens.delete(id);
}, 60_000).unref();
