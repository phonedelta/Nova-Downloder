import type {
  DownloadJob,
  DownloadJobType,
  DownloadSnapshot,
  VideoFormat,
} from "@nova/shared";
import {
  audioFilename,
  audioDisplayTitle,
  subtitleFilename,
  videoFilename,
} from "@nova/shared";
import { createJobId } from "./downloadManager";

export type StartDownloadPayload = {
  videoId: string;
  videoUrl: string;
  title: string;
  channel?: string;
  thumbnail?: string;
  downloadType: DownloadJobType;
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
};

/** Freeze click-time identity into an immutable snapshot (+ unique jobId). */
export function createDownloadSnapshot(
  payload: StartDownloadPayload & { jobId?: string; createdAt?: number },
): DownloadSnapshot {
  return {
    jobId: payload.jobId || createJobId(),
    videoId: payload.videoId,
    videoUrl: payload.videoUrl,
    title: payload.title,
    channel: payload.channel,
    thumbnail: payload.thumbnail,
    type: payload.downloadType,
    quality: payload.quality,
    formatId: payload.formatId,
    audioFormatId: payload.audioFormatId,
    bitrate: payload.bitrate,
    language: payload.language,
    targetLanguage: payload.targetLanguage,
    resolution: payload.resolution,
    fps: payload.fps,
    container: payload.container,
    codec: payload.codec,
    estimatedSize: payload.estimatedSize ?? null,
    filename: payload.filename,
    createdAt: payload.createdAt || Date.now(),
  };
}

export function snapshotToJob(snapshot: DownloadSnapshot): DownloadJob {
  return {
    id: snapshot.jobId,
    videoId: snapshot.videoId,
    videoUrl: snapshot.videoUrl,
    title: snapshot.title,
    channel: snapshot.channel,
    thumbnail: snapshot.thumbnail,
    type: snapshot.type,
    quality: snapshot.quality,
    format: snapshot.container,
    formatId: snapshot.formatId,
    audioFormatId: snapshot.audioFormatId,
    bitrate: snapshot.bitrate,
    language: snapshot.language,
    targetLanguage: snapshot.targetLanguage,
    resolution: snapshot.resolution,
    fps: snapshot.fps,
    container: snapshot.container,
    codec: snapshot.codec,
    filename: snapshot.filename,
    state: "preparing",
    bytesReceived: 0,
    totalBytes: null,
    estimatedTotalBytes: snapshot.estimatedSize ?? null,
    progress: null,
    progressEstimated: Boolean(snapshot.estimatedSize),
    speedBytesPerSecond: 0,
    etaSeconds: null,
    startedAt: snapshot.createdAt,
  };
}

export function videoPayloadFromFormat(opts: {
  videoId: string;
  videoUrl: string;
  title: string;
  channel?: string;
  thumbnail?: string;
  format: VideoFormat;
}): StartDownloadPayload {
  const { format } = opts;
  const container = format.ext === "mp4" ? "mp4" : "mkv";
  return {
    videoId: opts.videoId,
    videoUrl: opts.videoUrl,
    title: opts.title,
    channel: opts.channel,
    thumbnail: opts.thumbnail,
    downloadType: "video",
    quality: `${format.height}p`,
    formatId: format.id,
    audioFormatId: format.audioFormatId,
    resolution: `${format.height}p`,
    fps: format.fps,
    container,
    codec: format.codec,
    estimatedSize: format.displaySize,
    filename: videoFilename(
      opts.title,
      format.height,
      container === "mp4" ? "mp4" : "mkv",
    ),
  };
}

export function audioPayload(opts: {
  videoId: string;
  videoUrl: string;
  title: string;
  channel?: string;
  thumbnail?: string;
  bitrate: string;
}): StartDownloadPayload {
  const displayTitle = audioDisplayTitle(opts.title, opts.channel);
  return {
    videoId: opts.videoId,
    videoUrl: opts.videoUrl,
    title: displayTitle,
    channel: opts.channel,
    thumbnail: opts.thumbnail,
    downloadType: "audio",
    quality: opts.bitrate === "0" ? "Best" : `${opts.bitrate} kbps`,
    bitrate: opts.bitrate,
    container: "mp3",
    filename: audioFilename(opts.title, opts.channel),
  };
}

export function subtitlePayload(opts: {
  videoId: string;
  videoUrl: string;
  title: string;
  channel?: string;
  thumbnail?: string;
  language: string;
  targetLanguage?: string;
  langLabel: string;
}): StartDownloadPayload {
  return {
    videoId: opts.videoId,
    videoUrl: opts.videoUrl,
    title: opts.title,
    channel: opts.channel,
    thumbnail: opts.thumbnail,
    downloadType: "subtitle",
    quality: opts.langLabel,
    language: opts.language,
    targetLanguage: opts.targetLanguage,
    container: "srt",
    filename: subtitleFilename(opts.title, opts.langLabel),
  };
}
