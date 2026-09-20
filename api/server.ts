import { stat } from "node:fs/promises";
import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { resolve } from "node:path";
import { analyze } from "../backend/services/videoAnalyzer.service";
import {
  prepareDownload,
  handleStream,
  getStreamStatus,
  startMaterialize,
  cancelMaterialize,
  pauseMaterialize,
  type StreamKind,
} from "../backend/services/streamDownload.service";
import {
  prepareGenericDownload,
  handleGenericStream,
  analyzeGenericMedia,
} from "../backend/services/genericMedia.service";
import { publicError } from "../backend/services/process";
import { ensurePotServer, isPotServerReachable, potLogTail } from "../backend/services/potServer";
import { resolveCookiesFile, installCookiesFromBase64 } from "../backend/services/youtubeCookies";
import { youtubeUrl } from "../src/utils/format";
import { clearAnalysisCache } from "../backend/services/videoAnalyzer.service";
import { translateSrt } from "../backend/services/translation.service";
import { jobs, cleanupJob } from "../backend/services/download.service";

const app = express();
// Railway / reverse proxies set X-Forwarded-For — required for express-rate-limit
app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: false,
    // Allow chrome.downloads (and the extension) to fetch stream bytes cross-origin
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
app.use(express.json({ limit: "512kb" }));
app.set("timeout", 0);

/** Allow Nova web app + officially loaded extension IDs — never a blanket *. */
function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (origin === "http://127.0.0.1:5173" || origin === "http://localhost:5173")
    return true;
  if (origin === "http://127.0.0.1:3001" || origin === "http://localhost:3001")
    return true;
  // Same Railway / custom public domain
  try {
    const host = new URL(origin).hostname.toLowerCase();
    if (host.endsWith(".up.railway.app") || host.endsWith(".railway.app"))
      return true;
    const pub = (
      process.env.NOVA_PUBLIC_DOWNLOAD_BASE_URL ||
      process.env.RAILWAY_PUBLIC_DOMAIN ||
      ""
    ).toLowerCase();
    if (pub && (pub.includes(host) || origin.toLowerCase().includes(pub)))
      return true;
  } catch {
    /* */
  }
  const extra = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (extra.includes(origin)) return true;
  if (/^chrome-extension:\/\/[a-z]{32}$/.test(origin)) return true;
  if (/^moz-extension:\/\/[0-9a-f-]+$/.test(origin)) return true;
  return false;
}

function requestPublicHost(req: express.Request): {
  host?: string;
  proto?: string;
} {
  const xfHost = String(req.headers["x-forwarded-host"] || "")
    .split(",")[0]
    ?.trim();
  const host = xfHost || String(req.headers.host || "").trim();
  const xfProto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    ?.trim()
    .toLowerCase();
  const proto =
    xfProto === "http" || xfProto === "https"
      ? xfProto
      : req.secure
        ? "https"
        : "https";
  return { host: host || undefined, proto };
}

app.use("/api", (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,HEAD,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

app.use(
  "/api",
  rateLimit({
    windowMs: 60000,
    limit: 120,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Trop de requêtes. Réessayez dans une minute." },
  }),
);
const heavy = rateLimit({
  windowMs: 60000,
  limit: 12,
  message: { error: "Veuillez patienter avant de relancer une opération." },
});
const prepareLimit = rateLimit({
  windowMs: 60000,
  limit: 30,
  message: { error: "Veuillez patienter avant de relancer une opération." },
});
// Long streams must not be cut by a short rate-limit window mid-transfer
const streamLimit = rateLimit({
  windowMs: 60000,
  limit: 20,
  message: { error: "Trop de téléchargements. Réessayez dans une minute." },
});

app.get("/api/health", async (_q, r) =>
  r.json({
    status: "ok",
    service: "NovaDownloader",
    timestamp: new Date().toISOString(),
    translationAvailable: !!process.env.TRANSLATE_URL,
    youtubeCookies: !!resolveCookiesFile(),
    potConfigured: process.env.YT_DLP_POT_DISABLE !== "1",
    potReachable: await isPotServerReachable(),
    potLog: (await isPotServerReachable()) ? undefined : potLogTail(600) || undefined,
  }),
);

/** Install YouTube cookies at runtime (Bearer = DOWNLOAD_SIGNING_SECRET). */
app.post("/api/admin/youtube-cookies", express.json({ limit: "2mb" }), (q, r) => {
  const secret = process.env.DOWNLOAD_SIGNING_SECRET?.trim();
  const auth = String(q.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!secret || auth !== secret) {
    r.status(401).json({ error: "Non autorisé." });
    return;
  }
  const payload = String(q.body?.base64 || q.body?.cookies || "").trim();
  if (!payload) {
    r.status(400).json({ error: "Champ base64 manquant." });
    return;
  }
  const path = installCookiesFromBase64(payload);
  clearAnalysisCache();
  if (!path) {
    r.status(400).json({
      error: "Cookies invalides (attendu: Netscape cookies.txt en base64, gzip OK).",
    });
    return;
  }
  r.json({ ok: true, youtubeCookies: true });
});

/** Debug yt-dlp extract on the server (Bearer = DOWNLOAD_SIGNING_SECRET). */
app.post("/api/admin/probe-youtube", express.json({ limit: "32kb" }), async (q, r) => {
  const secret = process.env.DOWNLOAD_SIGNING_SECRET?.trim();
  const auth = String(q.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!secret || auth !== secret) {
    r.status(401).json({ error: "Non autorisé." });
    return;
  }
  const url = youtubeUrl(String(q.body?.url || ""));
  if (!url) {
    r.status(400).json({ error: "URL YouTube invalide." });
    return;
  }
  try {
    const { run, ytdlp, common } = await import("../backend/services/process");
    const raw = await run(
      ytdlp(),
      [...common(), "--dump-single-json", "--skip-download", "--", url],
      undefined,
      180000,
    );
    const data = JSON.parse(raw);
    const heights = [
      ...new Set(
        (data.formats || [])
          .map((f: { height?: number }) => f.height)
          .filter(Boolean),
      ),
    ].sort((a: number, b: number) => b - a);
    r.json({
      ok: true,
      title: data.title,
      id: data.id,
      heights: heights.slice(0, 12),
      formatCount: (data.formats || []).length,
      cookies: !!resolveCookiesFile(),
      potReachable: await isPotServerReachable(),
    });
  } catch (e) {
    r.status(422).json({
      ok: false,
      error: String(e).slice(-2500),
      cookies: !!resolveCookiesFile(),
      potReachable: await isPotServerReachable(),
      potLog: potLogTail(800) || undefined,
    });
  }
});

app.post("/api/analyze", heavy, async (q, r) => {
  if (!youtubeUrl(q.body.url)) {
    r.status(400).json({
      error: "Le lien renseigné n’est pas une URL YouTube valide.",
    });
    return;
  }
  try {
    r.json(await analyze(q.body.url));
  } catch (e) {
    console.error(e);
    r.status(422).json({
      error: String(e).includes("LIMIT_DURATION")
        ? "Les directs et les vidéos de plus de deux heures ne sont pas pris en charge."
        : publicError(e),
    });
  }
});

/** Fast prepare → signed stream URL (does not download the media). */
app.post("/api/download/prepare", prepareLimit, async (q, r) => {
  const kind = q.body.type as StreamKind;
  if (!["video", "audio", "subtitles"].includes(kind)) {
    r.status(400).json({ error: "Type de téléchargement invalide." });
    return;
  }
  if (!youtubeUrl(q.body.videoUrl)) {
    r.status(400).json({
      error: "Le lien renseigné n’est pas une URL YouTube valide.",
    });
    return;
  }
  try {
    const result = await prepareDownload(kind, q.body, requestPublicHost(q));
    r.json(result);
  } catch (e) {
    console.error(e);
    const status = String(e).includes("BUSY") ? 429 : 422;
    r.status(status).json({ error: publicError(e) });
  }
});

/**
 * Generic (non-YouTube) format probe via yt-dlp — lists available qualities.
 */
app.post("/api/download/generic/analyze", prepareLimit, async (q, r) => {
  try {
    const result = await analyzeGenericMedia({
      mediaUrl: q.body.mediaUrl,
      pageUrl: q.body.pageUrl,
      title: q.body.title,
      candidateUrls: Array.isArray(q.body.candidateUrls)
        ? q.body.candidateUrls.map(String)
        : undefined,
    });
    r.json(result);
  } catch (e) {
    console.error(e);
    const msg = String(e);
    const status =
      msg.includes("MEDIA_URL") || msg.includes("BLOCKED") ? 400 : 422;
    r.status(status).json({
      error:
        msg.includes("MEDIA_URL") ||
        msg.includes("BLOCKED") ||
        msg.includes("NO_FORMATS")
          ? "Source vidéo non prise en charge."
          : publicError(e),
    });
  }
});

/**
 * Generic (non-YouTube) direct media prepare.
 * Additive — does not alter the YouTube prepare path.
 */
app.post("/api/download/generic/prepare", prepareLimit, async (q, r) => {
  const kind = q.body.type as "video" | "audio";
  if (kind !== "video" && kind !== "audio") {
    r.status(400).json({ error: "Type de téléchargement invalide." });
    return;
  }
  try {
    const result = await prepareGenericDownload({
      mediaUrl: q.body.mediaUrl,
      type: kind,
      title: q.body.title,
      artist: q.body.artist,
      pageUrl: q.body.pageUrl,
      thumbnailUrl: q.body.thumbnailUrl,
      quality: q.body.quality,
      preferYtDlp: Boolean(q.body.preferYtDlp),
      formatId: q.body.formatId ? String(q.body.formatId) : undefined,
      audioFormatId: q.body.audioFormatId
        ? String(q.body.audioFormatId)
        : undefined,
      height:
        typeof q.body.height === "number" ? q.body.height : undefined,
    });
    r.json(result);
  } catch (e) {
    console.error(e);
    const msg = String(e);
    const status =
      msg.includes("MEDIA_URL") || msg.includes("TYPE_INVALID") ? 400 : 422;
    r.status(status).json({
      error:
        msg.includes("MEDIA_URL") || msg.includes("BLOCKED")
          ? "Source vidéo non prise en charge."
          : publicError(e),
    });
  }
});

app.get("/api/download/generic/stream/:id", streamLimit, async (q, r) => {
  q.setTimeout?.(0);
  r.setTimeout?.(0);
  const id = String(q.params.id || "");
  const sig = String(q.query.sig || "");
  await handleGenericStream(id, sig, q, r);
});

/** Build the media file server-side; poll /status for prepareProgress 0–100. */
app.post("/api/download/materialize/:id", prepareLimit, async (q, r) => {
  const id = String(q.params.id || "");
  const sig = String(q.query.sig || q.body?.sig || "");
  try {
    const result = startMaterialize(id, sig || undefined);
    r.json({ success: true, ...result });
  } catch (e) {
    const msg = String(e);
    const status = msg.includes("TOKEN_INVALID") ? 410 : 422;
    r.status(status).json({
      error:
        status === 410
          ? "Download token invalid or expired"
          : publicError(e),
    });
  }
});

/** Cancel an in-flight server-side materialize. */
app.post("/api/download/cancel/:id", async (q, r) => {
  const id = String(q.params.id || "");
  const sig = String(q.query.sig || q.body?.sig || "");
  try {
    const result = cancelMaterialize(id, sig || undefined);
    r.json({ success: true, ...result });
  } catch (e) {
    const msg = String(e);
    const status = msg.includes("TOKEN_INVALID") ? 410 : 422;
    r.status(status).json({
      error:
        status === 410
          ? "Download token invalid or expired"
          : publicError(e),
    });
  }
});

/** Pause materialize — keeps partial files for resume. */
app.post("/api/download/pause/:id", async (q, r) => {
  const id = String(q.params.id || "");
  const sig = String(q.query.sig || q.body?.sig || "");
  try {
    const result = pauseMaterialize(id, sig || undefined);
    r.json({ success: true, ...result });
  } catch (e) {
    const msg = String(e);
    const status = msg.includes("TOKEN_INVALID") ? 410 : 422;
    r.status(status).json({
      error:
        status === 410
          ? "Download token invalid or expired"
          : publicError(e),
    });
  }
});

app.get("/api/download/stream/:id", streamLimit, async (q, r) => {
  q.setTimeout?.(0);
  r.setTimeout?.(0);
  const id = String(q.params.id || "");
  const sig = String(q.query.sig || "");
  await handleStream(id, sig, q, r);
});

app.get("/api/download/status/:id", (q, r) => {
  const id = String(q.params.id || "");
  const status = getStreamStatus(id);
  if (!status) {
    r.status(404).json({ error: "Download token invalid or expired" });
    return;
  }
  r.json(status);
});

/** Legacy job-based endpoints kept briefly for compatibility. */
for (const [path, kind] of [
  ["/api/download/video", "video"],
  ["/api/download/audio", "audio"],
  ["/api/subtitles", "subtitles"],
] as const)
  app.post(path, prepareLimit, async (q, r) => {
    if (!youtubeUrl(q.body.videoUrl)) {
      r.status(400).json({
        error: "Le lien renseigné n’est pas une URL YouTube valide.",
      });
      return;
    }
    try {
      const result = await prepareDownload(kind, {
        ...q.body,
        type: kind,
      });
      // Prefer stream URL immediately instead of 202 job polling
      r.json({
        downloadUrl: result.downloadUrl,
        filename: result.filename,
        requiresMerge: result.requiresMerge,
      });
    } catch (e) {
      console.error(e);
      const status = String(e).includes("BUSY") ? 429 : 422;
      r.status(status).json({ error: publicError(e) });
    }
  });

app.get("/api/jobs/:id", (q, r) => {
  const j = jobs.get(q.params.id);
  if (!j) {
    r.status(404).json({ error: "Ce téléchargement a expiré." });
    return;
  }
  r.json({
    id: j.id,
    status: j.status,
    stage: j.stage,
    progress: j.progress,
    error: j.error,
    name: j.name,
  });
});
app.head("/api/jobs/:id/file", async (q, r) => {
  const job = jobs.get(q.params.id);
  if (!job || job.status !== "ready" || !job.file) {
    r.sendStatus(404);
    return;
  }
  try {
    const file = await stat(job.file);
    r.attachment(job.name!);
    const types: Record<string, string> = {
      mp4: "video/mp4",
      mkv: "video/x-matroska",
      mp3: "audio/mpeg",
      srt: "application/x-subrip; charset=utf-8",
    };
    r.setHeader(
      "Content-Type",
      types[job.file.split(".").pop() || ""] || "application/octet-stream",
    );
    r.setHeader("Content-Length", file.size);
    r.setHeader("Cache-Control", "private, no-store");
    r.status(200).end();
  } catch {
    r.sendStatus(404);
  }
});
app.get("/api/jobs/:id/file", (q, r) => {
  const j = jobs.get(q.params.id);
  if (!j || j.status !== "ready" || !j.file) {
    r.status(404).json({ error: "Fichier indisponible." });
    return;
  }
  const extension = j.file.split(".").pop();
  const contentTypes: Record<string, string> = {
    mp4: "video/mp4",
    mkv: "video/x-matroska",
    mp3: "audio/mpeg",
    srt: "application/x-subrip; charset=utf-8",
  };
  r.setHeader(
    "Content-Type",
    contentTypes[extension || ""] || "application/octet-stream",
  );
  r.setHeader("Cache-Control", "private, no-store");
  r.download(j.file, j.name!, { acceptRanges: false }, (error) => {
    if (error && !r.headersSent)
      r.status(410).json({ error: "Fichier indisponible." });
    void cleanupJob(j);
  });
});
app.post("/api/subtitles/translate", heavy, async (q, r) => {
  try {
    if (typeof q.body.subtitleData !== "string") throw Error();
    r.json({
      subtitleData: await translateSrt(
        q.body.subtitleData,
        q.body.sourceLanguage,
        q.body.targetLanguage,
      ),
    });
  } catch (e) {
    console.error(e);
    r.status(422).json({
      error:
        "La traduction est indisponible. Vérifiez la configuration du service et les sous-titres.",
    });
  }
});
app.use(express.static(resolve("dist")));
app.get("/{*path}", (q, r) => {
  // Never serve the SPA for API paths (would look like a successful HTML/JSON download)
  if (q.path.startsWith("/api")) {
    r.status(404).json({ error: "Route API introuvable." });
    return;
  }
  r.sendFile(resolve("dist/index.html"));
});
app.use(
  (
    err: unknown,
    _q: express.Request,
    r: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err);
    r.status(400).json({ error: "La requête ne peut pas être traitée." });
  },
);
void ensurePotServer().finally(() => {
  resolveCookiesFile();
  // Railway / containers must bind 0.0.0.0; local defaults to loopback.
  const host =
    process.env.HOST ||
    (process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === "production"
      ? "0.0.0.0"
      : "127.0.0.1");
  const port = Number(process.env.PORT) || 3001;
  const server = app.listen(port, host, () =>
    console.log(`Nova API: http://${host}:${port}`),
  );
  server.setTimeout(0);
  server.requestTimeout = 0;
  server.headersTimeout = 0;
});
