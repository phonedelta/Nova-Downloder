import type { DownloadJob, DownloadSnapshot } from "@nova/shared";
import type { ExtensionSettings } from "./api";

export type ExtensionMessage =
  | { type: "ANALYZE_VIDEO"; url: string; videoId: string }
  | {
      type: "START_DOWNLOAD";
      payload: Omit<DownloadSnapshot, "jobId" | "createdAt"> & {
        jobId?: string;
        createdAt?: number;
      };
    }
  /** @deprecated Prefer START_DOWNLOAD with a frozen snapshot */
  | {
      type: "DOWNLOAD_VIDEO";
      videoUrl: string;
      formatId: string;
      filename: string;
      videoId?: string;
      title?: string;
      thumbnail?: string;
      quality?: string;
      format?: string;
      audioFormatId?: string;
      estimatedTotalBytes?: number | null;
    }
  | {
      type: "DOWNLOAD_AUDIO";
      videoUrl: string;
      bitrate: string;
      filename: string;
      videoId?: string;
      title?: string;
      thumbnail?: string;
      quality?: string;
      format?: string;
      estimatedTotalBytes?: number | null;
    }
  | {
      type: "DOWNLOAD_SUBTITLE";
      videoUrl: string;
      language: string;
      targetLanguage?: string;
      filename: string;
      videoId?: string;
      title?: string;
      thumbnail?: string;
      quality?: string;
      format?: string;
      estimatedTotalBytes?: number | null;
    }
  | {
      type: "ANALYZE_GENERIC";
      payload: {
        mediaUrl: string;
        pageUrl?: string;
        title?: string;
        candidateUrls?: string[];
      };
    }
  | {
      type: "REGISTER_GENERIC_MEDIA";
      payload: {
        urls: string[];
        pageUrl?: string;
      };
    }
  | {
      type: "START_GENERIC_DOWNLOAD";
      payload: {
        mediaUrl: string;
        pageUrl: string;
        title: string;
        downloadType: "video" | "audio";
        quality?: string;
        container?: string;
        filename: string;
        height?: number;
        preferYtDlp?: boolean;
        formatId?: string;
        audioFormatId?: string;
      };
    }
  | { type: "GET_DOWNLOADS" }
  | { type: "GET_DOWNLOAD_STATUS"; jobId: string }
  | {
      type: "PAUSE_DOWNLOAD";
      jobId: string;
      chromeDownloadId?: number;
    }
  | {
      type: "RESUME_DOWNLOAD";
      jobId: string;
      chromeDownloadId?: number;
    }
  | {
      type: "CANCEL_DOWNLOAD";
      jobId: string;
      chromeDownloadId?: number;
    }
  | { type: "DISMISS_DOWNLOAD"; jobId: string }
  | { type: "OPEN_DOWNLOAD"; chromeDownloadId: number }
  | { type: "SHOW_DOWNLOAD"; chromeDownloadId: number }
  /** Silent stream download into Nova Downloader folders (saveAs: false). */
  | {
      type: "SILENT_STREAM_DOWNLOAD";
      downloadUrl: string;
      filename: string;
      kind: "video" | "audio" | "subtitles";
      title?: string;
      videoId?: string;
      videoUrl?: string;
      quality?: string;
      thumbnail?: string;
    }
  | { type: "GET_CURRENT_VIDEO" }
  | { type: "OPEN_PANEL" }
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; settings: Partial<ExtensionSettings> }
  | { type: "PING" };

export type ExtensionResponse =
  | { type: "ANALYZE_SUCCESS"; videoId: string; data: import("@nova/shared").Analysis }
  | { type: "ANALYZE_ERROR"; videoId: string; error: string }
  | {
      type: "ANALYZE_GENERIC_SUCCESS";
      data: import("../services/genericMediaAnalyzer").GenericAnalysis;
    }
  | { type: "ANALYZE_GENERIC_ERROR"; error: string }
  | {
      type: "DOWNLOAD_STARTED";
      jobId: string;
      chromeDownloadId?: number;
      filename: string;
      job?: DownloadJob;
    }
  | { type: "DOWNLOAD_PREPARING"; jobId: string; stage: string }
  | { type: "DOWNLOAD_ERROR"; error: string; jobId?: string }
  | { type: "DOWNLOADS"; downloads: DownloadJob[]; activeCount: number }
  | { type: "DOWNLOAD_STATUS"; job: DownloadJob | null }
  | { type: "DOWNLOAD_UPDATED"; job: DownloadJob }
  | {
      type: "CURRENT_VIDEO";
      videoId: string | null;
      url: string | null;
      title: string | null;
      isYouTube: boolean;
    }
  | { type: "SETTINGS"; settings: ExtensionSettings }
  | { type: "PONG" }
  | { type: "OK" };

export type PanelState =
  | "idle"
  | "analyzing"
  | "ready"
  | "preparing-download"
  | "error";

export type PanelScreen = "main" | "downloads";

export type PanelTab = "video" | "audio" | "subtitles";

export interface ExtensionSettings {
  preferredVideoQuality: "best" | "2160" | "1440" | "1080" | "720";
  preferredAudioQuality: "best" | "320" | "256" | "192";
  theme: "auto" | "light" | "dark";
  language: "auto" | "fr" | "en" | "ar" | "tr";
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  preferredVideoQuality: "best",
  preferredAudioQuality: "best",
  theme: "auto",
  language: "auto",
};
