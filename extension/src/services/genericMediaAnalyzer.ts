import { apiUrl, checkApiHealth, resolvePublicDownloadUrl } from "./novaApi";

export type GenericFormat = {
  id: string;
  height: number;
  width?: number;
  fps?: number | null;
  ext: string;
  codec: string;
  hasAudio: boolean;
  audioFormatId?: string;
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

export type GenericPrepareResult = {
  success: true;
  jobId: string;
  downloadUrl: string;
  filename: string;
  mimeType: string;
  expiresAt: string;
};

/**
 * POST /api/download/generic/analyze — list qualities via yt-dlp / HLS.
 * Call from the service worker only (avoids mixed-content on HTTPS pages).
 */
export async function analyzeGenericMedia(body: {
  mediaUrl: string;
  pageUrl?: string;
  title?: string;
  candidateUrls?: string[];
}): Promise<GenericAnalysis> {
  await checkApiHealth();
  const response = await fetch(apiUrl("/download/generic/analyze"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data: GenericAnalysis & { error?: string; success?: boolean };
  try {
    data = (await response.json()) as typeof data;
  } catch {
    throw new Error("Serveur NovaDownloader indisponible.");
  }
  if (!response.ok || data.success === false) {
    throw new Error(data.error || "Source vidéo non prise en charge.");
  }
  if (!Array.isArray(data.formats) || data.formats.length === 0) {
    throw new Error("Source vidéo non prise en charge.");
  }
  return { ...data, success: true };
}

/**
 * Client for POST /api/download/generic/prepare.
 * Separate from YouTube prepareDownload.
 */
export async function prepareGenericMedia(body: {
  mediaUrl: string;
  type: "video" | "audio";
  title?: string;
  pageUrl?: string;
  quality?: string;
  preferYtDlp?: boolean;
  formatId?: string;
  audioFormatId?: string;
  height?: number;
}): Promise<GenericPrepareResult> {
  await checkApiHealth();
  const response = await fetch(apiUrl("/download/generic/prepare"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data: GenericPrepareResult & { error?: string; success?: boolean };
  try {
    data = (await response.json()) as typeof data;
  } catch {
    throw new Error("Serveur NovaDownloader indisponible.");
  }
  if (!response.ok || data.success === false) {
    throw new Error(data.error || "Source vidéo non prise en charge.");
  }
  if (!data.downloadUrl) {
    throw new Error("Source vidéo non prise en charge.");
  }
  return {
    ...data,
    success: true,
    downloadUrl: resolvePublicDownloadUrl(data.downloadUrl),
  };
}

export function qualityLabel(
  height: number | null | undefined,
  index = 0,
): string {
  if (height && height > 0) {
    if (height >= 2160) return "4K 2160p";
    if (height >= 1440) return "1440p";
    if (height >= 1080) return "1080p Full HD";
    if (height >= 720) return "720p HD";
    if (height >= 480) return "480p";
    if (height >= 360) return "360p";
    return `${height}p`;
  }
  return index === 0 ? "Meilleure qualité" : `Source ${index + 1}`;
}

export function badgeForHeight(height: number): string | null {
  if (height >= 2160) return "4K";
  if (height >= 1080) return "Full HD";
  if (height >= 720) return "HD";
  return null;
}

export function formatBytesShort(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} Go`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} Mo`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} Ko`;
  return `${Math.round(n)} o`;
}
