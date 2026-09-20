/** Bitrates supplied by yt-dlp are in kilobits per second (decimal). */
export interface SizeMetadata {
  filesize?: number;
  filesizeApprox?: number;
  videoBitrate?: number;
  audioBitrate?: number;
  totalBitrate?: number;
}

export const positiveNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;

export function estimateFileSize(
  format: SizeMetadata,
  duration: number,
): number | null {
  const seconds = positiveNumber(duration);
  const bitrate =
    positiveNumber(format.totalBitrate) ??
    positiveNumber(
      (positiveNumber(format.videoBitrate) ?? 0) +
        (positiveNumber(format.audioBitrate) ?? 0),
    );
  if (!seconds || !bitrate) return null;
  return positiveNumber((bitrate * 1000 * seconds) / 8) ?? null;
}

export function resolveFileSize(format: SizeMetadata, duration: number) {
  const exact = positiveNumber(format.filesize);
  const approximate = positiveNumber(format.filesizeApprox);
  const estimatedSize = estimateFileSize(format, duration);
  return {
    displaySize: exact ?? approximate ?? estimatedSize,
    sizeEstimated: !exact,
    estimatedSize,
  };
}

/** Muxing changes container overhead: a sum of exact streams is still an estimate. */
export function resolveDownloadSize(
  video: SizeMetadata,
  duration: number,
  audio?: SizeMetadata | null,
) {
  const videoSize = resolveFileSize(video, duration);
  if (audio === undefined) return videoSize;
  const audioSize = audio ? resolveFileSize(audio, duration).displaySize : null;
  return {
    estimatedSize:
      videoSize.displaySize && audioSize
        ? videoSize.displaySize + audioSize
        : null,
    displaySize:
      videoSize.displaySize && audioSize
        ? videoSize.displaySize + audioSize
        : null,
    sizeEstimated: true,
  };
}

export function formatFileSize(bytes: number | null | undefined): string {
  const value = positiveNumber(bytes);
  if (!value) return "Non disponible";
  const divisor = value >= 1e9 ? 1e9 : value >= 1e6 ? 1e6 : 1e3;
  const unit = divisor === 1e9 ? "GB" : divisor === 1e6 ? "MB" : "KB";
  const number = Math.round((value / divisor) * 100) / 100;
  return number > 0 ? `${number} ${unit}` : "<0.01 KB";
}

/** Display size with ~ prefix when estimated. */
export function displayFileSize(
  bytes: number | null | undefined,
  estimated: boolean,
): string {
  const formatted = formatFileSize(bytes);
  if (formatted === "Non disponible") return formatted;
  return estimated ? `~${formatted}` : formatted;
}
