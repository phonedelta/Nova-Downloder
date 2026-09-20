export interface VideoFormat {
  id: string;
  height: number;
  ext: string;
  fps?: number;
  /** Original stream size retained for server-side limits. */
  size?: number;
  width?: number;
  resolution: string;
  videoBitrate?: number;
  audioBitrate?: number;
  totalBitrate?: number;
  filesize?: number;
  filesizeApprox?: number;
  estimatedSize: number | null;
  displaySize: number | null;
  sizeEstimated: boolean;
  audioFormatId?: string;
  codec: string;
  hdr?: string;
  hasAudio: boolean;
}

export interface Analysis {
  video: {
    id: string;
    url: string;
    title: string;
    thumbnail: string;
    duration: number;
    channel: string;
    views?: number;
    date?: string;
    description?: string;
  };
  formats: VideoFormat[];
  audioFormats: {
    id: string;
    codec: string;
    bitrate?: number;
    language?: string;
  }[];
  subtitles: {
    id: string;
    language: string;
    name: string;
    automatic: boolean;
  }[];
  translationAvailable: boolean;
}

export interface Recent {
  title: string;
  thumbnail: string;
  format: string;
  date: string;
}

export type JobStatus = "processing" | "ready" | "error";

export interface JobInfo {
  id: string;
  status: JobStatus;
  stage: string;
  progress?: number;
  error?: string;
  name?: string;
}
