/** Shared download job model for extension + web status APIs. */

export type DownloadJobType = "video" | "audio" | "subtitle";

export type DownloadJobState =
  | "preparing"
  | "starting"
  | "downloading"
  | "paused"
  | "completed"
  | "interrupted"
  | "cancelled"
  | "failed"
  | "queued";

/**
 * Immutable identity of a download, frozen at click time.
 * Never rewrite these fields from the current YouTube page.
 */
export interface DownloadSnapshot {
  jobId: string;
  videoId: string;
  videoUrl: string;
  title: string;
  channel?: string;
  thumbnail?: string;
  type: DownloadJobType;
  quality?: string;
  formatId?: string;
  audioFormatId?: string;
  bitrate?: string;
  language?: string;
  targetLanguage?: string;
  resolution?: string;
  fps?: number;
  container?: string;
  codec?: string;
  estimatedSize?: number | null;
  filename: string;
  createdAt: number;
}

export interface DownloadJob {
  id: string;
  chromeDownloadId?: number;
  /** Backend stream token id when available */
  streamTokenId?: string;

  videoId: string;
  videoUrl?: string;
  title: string;
  channel?: string;
  thumbnail?: string;

  type: DownloadJobType;
  quality?: string;
  format?: string;
  /** Frozen at start — never take from current page */
  formatId?: string;
  audioFormatId?: string;
  bitrate?: string;
  language?: string;
  targetLanguage?: string;
  resolution?: string;
  fps?: number;
  container?: string;
  codec?: string;

  /** Intended relative/browser path (never trust Chrome's .json rename) */
  filename: string;

  state: DownloadJobState;

  bytesReceived: number;
  totalBytes: number | null;
  estimatedTotalBytes?: number | null;

  /** 0–100, or null when unknown */
  progress: number | null;
  /** True when progress uses estimatedTotalBytes */
  progressEstimated?: boolean;

  speedBytesPerSecond?: number;
  etaSeconds?: number | null;

  startedAt: number;
  completedAt?: number;
  error?: string;
  errorCode?: string;
}

export type DownloadJobPersisted = Pick<
  DownloadJob,
  | "id"
  | "chromeDownloadId"
  | "streamTokenId"
  | "videoId"
  | "videoUrl"
  | "title"
  | "channel"
  | "thumbnail"
  | "type"
  | "quality"
  | "format"
  | "formatId"
  | "audioFormatId"
  | "bitrate"
  | "language"
  | "targetLanguage"
  | "resolution"
  | "fps"
  | "container"
  | "codec"
  | "filename"
  | "estimatedTotalBytes"
  | "startedAt"
  | "state"
  | "error"
  | "errorCode"
>;

/** Minimum bytes for Chrome "complete" to count as a real media success. */
export function minSuccessBytes(type: DownloadJobType): number {
  if (type === "subtitle") return 32;
  if (type === "audio") return 4_096;
  return 8_192;
}

export function isActiveDownloadState(state: DownloadJobState): boolean {
  return (
    state === "preparing" ||
    state === "starting" ||
    state === "downloading" ||
    state === "paused" ||
    state === "queued"
  );
}

export function isFailedDownloadState(state: DownloadJobState): boolean {
  return (
    state === "failed" || state === "interrupted" || state === "cancelled"
  );
}

export function isCompletedDownloadState(state: DownloadJobState): boolean {
  return state === "completed";
}

export function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function computeProgress(
  bytesReceived: number,
  totalBytes: number | null | undefined,
  _estimatedTotalBytes?: number | null,
): { progress: number | null; estimated: boolean } {
  // Exact Chrome/HTTP total only — never invent % from estimates.
  void _estimatedTotalBytes;
  const exact =
    typeof totalBytes === "number" && totalBytes > 0 ? totalBytes : null;
  if (!exact || bytesReceived < 0) return { progress: null, estimated: false };
  return {
    progress: clampProgress((bytesReceived / exact) * 100),
    estimated: false,
  };
}

/** Alias matching the product brief; wraps formatFileSize semantics. */
export function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
    return "—";
  }
  if (bytes === 0) return "0 KB";
  const divisor = bytes >= 1e9 ? 1e9 : bytes >= 1e6 ? 1e6 : 1e3;
  const unit = divisor === 1e9 ? "GB" : divisor === 1e6 ? "MB" : "KB";
  const number = Math.round((bytes / divisor) * 100) / 100;
  return number > 0 ? `${number} ${unit}` : "<0.01 KB";
}

export function formatSpeed(bytesPerSecond: number | null | undefined): string {
  if (
    typeof bytesPerSecond !== "number" ||
    !Number.isFinite(bytesPerSecond) ||
    bytesPerSecond <= 0
  ) {
    return "—";
  }
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** Compact duration for ETA display. */
export function formatETA(seconds: number | null | undefined): string {
  if (
    typeof seconds !== "number" ||
    !Number.isFinite(seconds) ||
    seconds < 0
  ) {
    return "";
  }
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  if (mins < 60) {
    return rem > 0
      ? `${mins} min ${String(rem).padStart(2, "0")} s`
      : `${mins} min`;
  }
  const hours = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${hours} h ${m} min` : `${hours} h`;
}

export function formatDuration(seconds: number | null | undefined): string {
  return formatETA(seconds);
}

export function smoothSpeed(
  previous: number | undefined,
  sample: number,
  alpha = 0.3,
): number {
  if (!Number.isFinite(sample) || sample < 0) return previous ?? 0;
  if (previous === undefined || !Number.isFinite(previous)) return sample;
  return previous * (1 - alpha) + sample * alpha;
}

export function computeEtaSeconds(
  remainingBytes: number,
  speedBytesPerSecond: number | undefined,
): number | null {
  if (
    !speedBytesPerSecond ||
    speedBytesPerSecond < 256 ||
    !Number.isFinite(remainingBytes) ||
    remainingBytes < 0
  ) {
    return null;
  }
  const eta = remainingBytes / speedBytesPerSecond;
  if (!Number.isFinite(eta) || eta < 0) return null;
  return eta;
}
