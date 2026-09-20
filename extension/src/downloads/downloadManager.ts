import type {
  DownloadJob,
  DownloadJobPersisted,
  DownloadJobState,
  DownloadJobType,
} from "@nova/shared";
import {
  computeEtaSeconds,
  computeProgress,
  isActiveDownloadState,
  isFailedDownloadState,
  minSuccessBytes,
  smoothSpeed,
} from "@nova/shared";

export const DOWNLOADS_STORAGE_KEY = "novaDownloadJobs";
export const MAX_RECENT_COMPLETED = 12;
export const MAX_RECENT_FAILED = 12;

type SpeedSample = {
  bytes: number;
  ts: number;
  smoothed?: number;
};

const speedByJob = new Map<string, SpeedSample>();

export function createJobId(): string {
  return crypto.randomUUID();
}

export function toPersisted(job: DownloadJob): DownloadJobPersisted {
  return {
    id: job.id,
    chromeDownloadId: job.chromeDownloadId,
    streamTokenId: job.streamTokenId,
    videoId: job.videoId,
    videoUrl: job.videoUrl,
    title: job.title,
    channel: job.channel,
    thumbnail: job.thumbnail,
    type: job.type,
    quality: job.quality,
    format: job.format,
    formatId: job.formatId,
    audioFormatId: job.audioFormatId,
    bitrate: job.bitrate,
    language: job.language,
    targetLanguage: job.targetLanguage,
    resolution: job.resolution,
    fps: job.fps,
    container: job.container,
    codec: job.codec,
    filename: job.filename,
    estimatedTotalBytes: job.estimatedTotalBytes,
    startedAt: job.startedAt,
    state: job.state,
    error: job.error,
    errorCode: job.errorCode,
  };
}

export function fromPersisted(row: DownloadJobPersisted): DownloadJob {
  const job: DownloadJob = {
    ...row,
    bytesReceived: 0,
    totalBytes: null,
    progress: null,
    progressEstimated: false,
    speedBytesPerSecond: 0,
    etaSeconds: null,
  };
  return sanitizeLegacyJob(job);
}

/** Migrate polluted history: *.json media jobs → failed. */
export function sanitizeLegacyJob(job: DownloadJob): DownloadJob {
  const base = job.filename.split(/[/\\]/).pop() || job.filename;
  const looksJson = /\.json$/i.test(base);
  const media = job.type === "video" || job.type === "audio";
  if (looksJson && media) {
    return {
      ...job,
      state: "failed",
      error: "Téléchargement invalide (réponse JSON).",
      errorCode: "INVALID_JSON_DOWNLOAD",
      progress: job.bytesReceived > 0 ? job.progress : 0,
      completedAt: job.completedAt || Date.now(),
    };
  }
  if (
    job.state === "completed" &&
    job.bytesReceived < minSuccessBytes(job.type)
  ) {
    return {
      ...job,
      state: "failed",
      error: "Serveur NovaDownloader indisponible.",
      errorCode: "EMPTY_OR_ERROR_BODY",
      progress: 0,
      completedAt: job.completedAt || Date.now(),
    };
  }
  return job;
}

export function mapChromeError(error?: string): {
  message: string;
  code: string;
} {
  if (!error) {
    return { message: "Téléchargement interrompu.", code: "INTERRUPTED" };
  }
  switch (error) {
    case "USER_CANCELED":
      return { message: "Téléchargement annulé.", code: "USER_CANCELED" };
    case "NETWORK_FAILED":
    case "NETWORK_TIMEOUT":
    case "NETWORK_DISCONNECTED":
    case "NETWORK_SERVER_DOWN":
      return {
        message: "Cette vidéo ne peut pas être téléchargée.",
        code: "SERVER_UNAVAILABLE",
      };
    case "SERVER_FAILED":
    case "SERVER_BAD_CONTENT":
    case "SERVER_UNAUTHORIZED":
    case "SERVER_FORBIDDEN":
    case "SERVER_UNREACHABLE":
      return {
        message: "Cette vidéo ne peut pas être téléchargée.",
        code: "SERVER_UNAVAILABLE",
      };
    case "FILE_ACCESS_DENIED":
    case "FILE_NO_SPACE":
    case "FILE_NAME_TOO_LONG":
    case "FILE_TOO_LARGE":
    case "FILE_VIRUS_INFECTED":
    case "FILE_TRANSIENT_ERROR":
    case "FILE_BLOCKED":
    case "FILE_SECURITY_CHECK_FAILED":
      return {
        message: "Impossible d’écrire le fichier.",
        code: "FILE_ERROR",
      };
    default:
      return { message: "Téléchargement interrompu.", code: "INTERRUPTED" };
  }
}

/**
 * Chrome may mark a tiny JSON error body as state=complete.
 * NovaDownloader only accepts real media completions.
 */
export function resolveFinalState(
  job: DownloadJob,
  item: chrome.downloads.DownloadItem,
  bytesReceived: number,
): {
  state: DownloadJobState;
  error?: string;
  errorCode?: string;
  progress: number | null;
} {
  const chromePath = (item.filename || "").toLowerCase();
  const mime = (item.mime || "").toLowerCase();
  const media = job.type === "video" || job.type === "audio";
  const minBytes = minSuccessBytes(job.type);

  if (item.state === "interrupted") {
    if (item.error === "USER_CANCELED") {
      return {
        state: "cancelled",
        error: "Téléchargement annulé.",
        errorCode: "USER_CANCELED",
        progress: job.progress ?? (bytesReceived > 0 ? job.progress : 0),
      };
    }
    const mapped = mapChromeError(item.error);
    return {
      state: "failed",
      error: mapped.message,
      errorCode: mapped.code,
      progress: job.progress ?? 0,
    };
  }

  if (item.paused) {
    return { state: "paused", progress: job.progress };
  }

  if (item.state === "in_progress") {
    // Stay on "starting" until Chrome actually receives bytes
    if (bytesReceived <= 0) {
      return { state: "starting", progress: null };
    }
    return { state: "downloading", progress: job.progress };
  }

  if (item.state === "complete") {
    const looksLikeJson =
      mime.includes("json") ||
      chromePath.endsWith(".json") ||
      (media && bytesReceived > 0 && bytesReceived < 2048 && mime.includes("json"));

    if (looksLikeJson && media) {
      return {
        state: "failed",
        error: "Cette vidéo ne peut pas être téléchargée.",
        errorCode: "JSON_ERROR_BODY",
        progress: 0,
      };
    }

    if (bytesReceived < minBytes) {
      return {
        state: "failed",
        error: "Cette vidéo ne peut pas être téléchargée.",
        errorCode: "EMPTY_OR_ERROR_BODY",
        progress: 0,
      };
    }

    // Suspicious: tiny "total" equal to received (classic error JSON size ~80B)
    if (
      media &&
      bytesReceived < 4096 &&
      item.totalBytes > 0 &&
      item.totalBytes === bytesReceived
    ) {
      return {
        state: "failed",
        error: "Cette vidéo ne peut pas être téléchargée.",
        errorCode: "SUSPICIOUS_TINY_COMPLETE",
        progress: 0,
      };
    }

    return { state: "completed", progress: 100 };
  }

  return { state: "downloading", progress: job.progress };
}

/** Merge Chrome DownloadItem into a job and update smoothed speed. */
export function applyChromeItem(
  job: DownloadJob,
  item: chrome.downloads.DownloadItem,
  now = Date.now(),
): DownloadJob {
  const bytesReceived = Math.max(0, item.bytesReceived || 0);
  const totalRaw = item.totalBytes;
  // Chrome uses -1 for unknown; only positive totals are exact.
  const totalBytes =
    typeof totalRaw === "number" && totalRaw > 0 ? totalRaw : null;
  const fileSize =
    typeof item.fileSize === "number" && item.fileSize > 0
      ? item.fileSize
      : null;
  // Prefer totalBytes; fileSize is also exact when Chrome knows the final size.
  const exactTotal = totalBytes ?? fileSize;

  const prev = speedByJob.get(job.id);
  let speed = job.speedBytesPerSecond || 0;
  if (prev && now > prev.ts) {
    const deltaBytes = bytesReceived - prev.bytes;
    const deltaSec = (now - prev.ts) / 1000;
    if (deltaSec > 0 && deltaBytes >= 0) {
      const sample = deltaBytes / deltaSec;
      // EMA: 0.7 previous + 0.3 current (alpha = 0.3)
      speed = smoothSpeed(prev.smoothed ?? speed, sample, 0.3);
    }
  }
  speedByJob.set(job.id, { bytes: bytesReceived, ts: now, smoothed: speed });

  const { progress: rawProgress } = computeProgress(
    bytesReceived,
    exactTotal,
    null,
  );

  let etaSeconds: number | null = null;
  if (exactTotal != null && bytesReceived > 0) {
    if (item.estimatedEndTime) {
      const end = Date.parse(item.estimatedEndTime);
      if (Number.isFinite(end) && end > now) {
        etaSeconds = (end - now) / 1000;
      }
    }
    if (etaSeconds == null) {
      etaSeconds = computeEtaSeconds(
        Math.max(0, exactTotal - bytesReceived),
        speed,
      );
    }
  }

  const provisional: DownloadJob = {
    ...job,
    progress: rawProgress,
  };
  const resolved = resolveFinalState(provisional, item, bytesReceived);

  // Never adopt Chrome's .json/.txt error rename as our display filename
  const chromeBase = (item.filename || "").split(/[/\\]/).pop() || "";
  const keepOurName =
    !chromeBase ||
    /\.(json|txt|html|htm)$/i.test(chromeBase) ||
    job.filename.toLowerCase().includes("nova downloader");

  const next: DownloadJob = {
    ...job,
    chromeDownloadId: item.id,
    filename: keepOurName ? job.filename : item.filename || job.filename,
    state: resolved.state,
    bytesReceived,
    totalBytes:
      resolved.state === "failed" && bytesReceived < minSuccessBytes(job.type)
        ? null
        : exactTotal,
    progress:
      resolved.state === "completed"
        ? 100
        : resolved.state === "failed" || resolved.state === "cancelled"
          ? resolved.progress ?? (bytesReceived > 0 ? rawProgress : 0)
          : resolved.state === "preparing"
            ? job.progress
            : resolved.state === "starting" && bytesReceived <= 0
              ? job.progress
              : rawProgress,
    progressEstimated: false,
    speedBytesPerSecond:
      resolved.state === "downloading" || resolved.state === "starting"
        ? speed
        : 0,
    etaSeconds:
      resolved.state === "completed"
        ? 0
        : resolved.state === "downloading"
          ? etaSeconds
          : null,
    error: resolved.error,
    errorCode: resolved.errorCode,
    completedAt:
      resolved.state === "completed" || isFailedDownloadState(resolved.state)
        ? job.completedAt || now
        : job.completedAt,
  };
  return next;
}

export function sortJobs(jobs: DownloadJob[]): DownloadJob[] {
  return [...jobs].sort((a, b) => {
    const rank = (s: DownloadJobState) =>
      isActiveDownloadState(s) ? 0 : s === "completed" ? 1 : 2;
    const ra = rank(a.state);
    const rb = rank(b.state);
    if (ra !== rb) return ra - rb;
    return b.startedAt - a.startedAt;
  });
}

export function pruneJobs(jobs: DownloadJob[]): DownloadJob[] {
  const cleaned = jobs.map(sanitizeLegacyJob);
  const active = cleaned.filter((j) => isActiveDownloadState(j.state));
  const completed = cleaned
    .filter((j) => j.state === "completed")
    .sort(
      (a, b) =>
        (b.completedAt || b.startedAt) - (a.completedAt || a.startedAt),
    )
    .slice(0, MAX_RECENT_COMPLETED);
  const failed = cleaned
    .filter((j) => isFailedDownloadState(j.state))
    .sort(
      (a, b) =>
        (b.completedAt || b.startedAt) - (a.completedAt || a.startedAt),
    )
    .slice(0, MAX_RECENT_FAILED);
  return sortJobs([...active, ...completed, ...failed]);
}

export function activeCount(jobs: DownloadJob[]): number {
  return jobs.filter((j) => isActiveDownloadState(j.state)).length;
}

export type StartDownloadMeta = {
  videoId: string;
  videoUrl: string;
  title: string;
  channel?: string;
  thumbnail?: string;
  type: DownloadJobType;
  quality?: string;
  format?: string;
  formatId?: string;
  audioFormatId?: string;
  bitrate?: string;
  language?: string;
  targetLanguage?: string;
  resolution?: string;
  fps?: number;
  container?: string;
  codec?: string;
  filename: string;
  estimatedTotalBytes?: number | null;
};
