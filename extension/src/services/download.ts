import type { Analysis, JobInfo } from "@nova/shared";
import {
  apiUrl,
  assertBrowserDownloadUrl,
  checkApiHealth,
  resolvePublicDownloadUrl,
} from "./novaApi";
import { debugLog } from "../utils/debug";

export type PrepareDownloadResult = {
  success: true;
  jobId?: string;
  downloadUrl: string;
  filename: string;
  mimeType?: string;
  estimatedSize?: number | null;
  expiresAt?: string;
  requiresMerge?: boolean;
};

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const url = apiUrl(path);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data: { error?: string } & T;
  try {
    data = (await response.json()) as { error?: string } & T;
  } catch {
    throw new Error("Impossible de contacter NovaDownloader.");
  }
  if (!response.ok) {
    throw new Error(
      data.error || "Le serveur est momentanément indisponible.",
    );
  }
  return data;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path));
  let data: { error?: string } & T;
  try {
    data = (await response.json()) as { error?: string } & T;
  } catch {
    throw new Error("Impossible de contacter NovaDownloader.");
  }
  if (!response.ok) {
    throw new Error(
      data.error || "Le serveur est momentanément indisponible.",
    );
  }
  return data;
}

export async function analyzeVideo(url: string): Promise<Analysis> {
  debugLog("analyze", url);
  return postJson<Analysis>("/analyze", { url });
}

/**
 * POST /api/download/prepare → JSON only.
 * Never pass this URL to chrome.downloads — only response.downloadUrl (stream).
 */
export async function prepareDownload(body: {
  type: "video" | "audio" | "subtitles";
  videoUrl: string;
  formatId?: string;
  bitrate?: string;
  language?: string;
  targetLanguage?: string;
}): Promise<PrepareDownloadResult> {
  await checkApiHealth();

  const prepareUrl = apiUrl("/download/prepare");
  console.log("[NOVA PREPARE] URL:", prepareUrl);
  console.log("[NOVA DOWNLOAD] type:", body.type);

  const response = await fetch(prepareUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const contentType = response.headers.get("content-type") || "";
  console.log("[NOVA PREPARE] HTTP status:", response.status);
  console.log("[NOVA PREPARE] Content-Type:", contentType);

  let data: PrepareDownloadResult & { error?: string; success?: boolean };
  try {
    data = (await response.json()) as PrepareDownloadResult & {
      error?: string;
      success?: boolean;
    };
  } catch {
    throw new Error("Serveur NovaDownloader indisponible.");
  }

  console.log("[NOVA PREPARE] response:", {
    success: data.success,
    downloadUrl: data.downloadUrl,
    filename: data.filename,
    mimeType: data.mimeType,
    jobId: data.jobId,
  });

  if (!response.ok) {
    throw new Error(
      data.error || `Prepare failed: ${response.status}`,
    );
  }

  if (data.success === false) {
    throw new Error(data.error || "Prepare failed");
  }

  if (typeof data.downloadUrl !== "string" || !data.downloadUrl.trim()) {
    throw new Error("Backend did not return downloadUrl");
  }
  if (typeof data.filename !== "string" || !data.filename.trim()) {
    throw new Error("Invalid prepare response: missing filename");
  }

  // Never treat prepare URL itself as a download target
  if (
    data.downloadUrl.includes("/download/prepare") ||
    prepareUrl === data.downloadUrl
  ) {
    throw new Error("Invalid prepare response: downloadUrl points to prepare");
  }

  const absolute = resolvePublicDownloadUrl(data.downloadUrl);
  const parsed = assertBrowserDownloadUrl(absolute);

  console.log("[NOVA DOWNLOAD] final URL:", parsed.toString());
  console.log("[NOVA DOWNLOAD] final filename:", data.filename);

  return {
    success: true,
    jobId: data.jobId,
    downloadUrl: parsed.toString(),
    filename: data.filename,
    mimeType: data.mimeType,
    estimatedSize: data.estimatedSize,
    expiresAt: data.expiresAt,
    requiresMerge: data.requiresMerge,
  };
}

export type StreamStatus = {
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
};

function streamIdAndSig(downloadUrl: string): { id: string; sig: string } {
  const u = new URL(downloadUrl);
  const m = u.pathname.match(/\/download\/stream\/([^/?#]+)/);
  const id = m?.[1];
  if (!id) throw new Error("Invalid downloadUrl");
  return { id, sig: u.searchParams.get("sig") || "" };
}

/** Kick off server-side file build (progress via getStreamDownloadStatus). */
export async function materializeDownload(
  downloadUrl: string,
): Promise<{
  jobId: string;
  state: string;
  prepareProgress: number | null;
  totalBytes: number | null;
}> {
  const { id, sig } = streamIdAndSig(downloadUrl);
  const path = `/download/materialize/${encodeURIComponent(id)}?sig=${encodeURIComponent(sig)}`;
  return postJson(path, {});
}

export async function cancelServerMaterialize(
  downloadUrlOrTokenId: string,
  sig?: string,
): Promise<void> {
  let id = downloadUrlOrTokenId;
  let tokenSig = sig || "";
  if (downloadUrlOrTokenId.includes("://") || downloadUrlOrTokenId.includes("/")) {
    const parsed = streamIdAndSig(downloadUrlOrTokenId);
    id = parsed.id;
    tokenSig = parsed.sig;
  }
  if (!id) return;
  try {
    await postJson(
      `/download/cancel/${encodeURIComponent(id)}?sig=${encodeURIComponent(tokenSig)}`,
      {},
    );
  } catch {
    /* best-effort */
  }
}

export async function pauseServerMaterialize(
  downloadUrlOrTokenId: string,
  sig?: string,
): Promise<void> {
  let id = downloadUrlOrTokenId;
  let tokenSig = sig || "";
  if (downloadUrlOrTokenId.includes("://") || downloadUrlOrTokenId.includes("/")) {
    const parsed = streamIdAndSig(downloadUrlOrTokenId);
    id = parsed.id;
    tokenSig = parsed.sig;
  }
  if (!id) return;
  try {
    await postJson(
      `/download/pause/${encodeURIComponent(id)}?sig=${encodeURIComponent(tokenSig)}`,
      {},
    );
  } catch {
    /* best-effort */
  }
}

export async function getStreamDownloadStatus(
  jobId: string,
): Promise<StreamStatus> {
  return getJson<StreamStatus>(
    `/download/status/${encodeURIComponent(jobId)}`,
  );
}

/**
 * Wait until the server has finished building the file (or failed).
 * Calls onProgress with 0–100 prepare progress for the Active list UI.
 */
export async function waitUntilMaterialized(
  downloadUrl: string,
  onProgress?: (info: {
    prepareProgress: number | null;
    totalBytes: number | null;
    estimatedTotalBytes: number | null;
    speedBytesPerSecond: number;
    etaSeconds: number | null;
    state: string;
  }) => void,
  signal?: AbortSignal,
): Promise<StreamStatus> {
  await materializeDownload(downloadUrl);
  const { id } = streamIdAndSig(downloadUrl);

  const started = Date.now();
  const maxMs = 45 * 60 * 1000;

  for (;;) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const status = await getStreamDownloadStatus(id);
    onProgress?.({
      prepareProgress: status.prepareProgress,
      totalBytes: status.totalBytes,
      estimatedTotalBytes: status.estimatedTotalBytes,
      speedBytesPerSecond: status.speedBytesPerSecond || 0,
      etaSeconds: status.etaSeconds,
      state: status.state,
    });

    if (status.state === "ready" || status.state === "downloading") {
      return status;
    }
    if (status.state === "paused") {
      throw new DOMException("Paused", "AbortError");
    }
    if (status.state === "cancelled") {
      throw new DOMException("Aborted", "AbortError");
    }
    if (status.state === "failed" || status.state === "completed") {
      if (status.error?.code === "CANCELLED") {
        throw new DOMException("Aborted", "AbortError");
      }
      if (status.error) {
        throw new Error(status.error.message || "Préparation échouée");
      }
      if (status.state === "failed") {
        throw new Error("La préparation du fichier a échoué.");
      }
      return status;
    }
    if (Date.now() - started > maxMs) {
      throw new Error("Préparation trop longue — réessayez.");
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** @deprecated */
export async function createVideoJob(
  videoUrl: string,
  formatId: string,
): Promise<string> {
  const { downloadUrl } = await prepareDownload({
    type: "video",
    videoUrl,
    formatId,
  });
  return downloadUrl;
}

export async function createAudioJob(
  videoUrl: string,
  bitrate: string,
): Promise<string> {
  const { downloadUrl } = await prepareDownload({
    type: "audio",
    videoUrl,
    bitrate,
  });
  return downloadUrl;
}

export async function createSubtitleJob(
  videoUrl: string,
  language: string,
  targetLanguage?: string,
): Promise<string> {
  const { downloadUrl } = await prepareDownload({
    type: "subtitles",
    videoUrl,
    language,
    targetLanguage,
  });
  return downloadUrl;
}

export async function getJob(jobId: string): Promise<JobInfo> {
  return getJson<JobInfo>(`/jobs/${encodeURIComponent(jobId)}`);
}

export function jobFileUrl(jobId: string): string {
  return apiUrl(`/jobs/${encodeURIComponent(jobId)}/file`);
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const analysisCache = new Map<
  string,
  { data: Analysis; expires: number }
>();

export function getCachedAnalysis(videoId: string): Analysis | null {
  const entry = analysisCache.get(videoId);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    analysisCache.delete(videoId);
    return null;
  }
  return entry.data;
}

export function setCachedAnalysis(videoId: string, data: Analysis): void {
  const heights = new Set(data.formats.map((f) => f.height));
  if (heights.size < 3) return;
  analysisCache.set(videoId, {
    data,
    expires: Date.now() + CACHE_TTL_MS,
  });
}

export function clearCachedAnalysis(videoId?: string): void {
  if (videoId) analysisCache.delete(videoId);
  else analysisCache.clear();
}

const inflight = new Map<string, Promise<Analysis>>();

export function analyzeOnce(videoId: string, url: string): Promise<Analysis> {
  const cached = getCachedAnalysis(videoId);
  if (cached) return Promise.resolve(cached);
  const existing = inflight.get(videoId);
  if (existing) return existing;
  const promise = analyzeVideo(url)
    .then((data) => {
      setCachedAnalysis(videoId, data);
      return data;
    })
    .finally(() => {
      inflight.delete(videoId);
    });
  inflight.set(videoId, promise);
  return promise;
}
