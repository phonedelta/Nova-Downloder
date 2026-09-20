/**
 * Start a download without a Save As dialog when the NovaDownloader
 * extension is present (chrome.downloads + saveAs:false + folders).
 * Falls back to a same-origin <a> click (iframe is unreliable for attachments).
 */

function extensionInstalled(): boolean {
  return document.documentElement.dataset.novaExtension === "1";
}

/** Rewrite prepare URLs that incorrectly point at localhost (common on Railway). */
export function resolveDownloadUrl(downloadUrl: string): string {
  const raw = String(downloadUrl || "").trim();
  if (!raw) return raw;
  try {
    const u = new URL(raw, window.location.origin);
    if (
      u.hostname === "127.0.0.1" ||
      u.hostname === "localhost" ||
      /TON-SERVICE/i.test(u.hostname)
    ) {
      return `${window.location.origin}${u.pathname}${u.search}`;
    }
    return u.toString();
  } catch {
    if (raw.startsWith("/")) return `${window.location.origin}${raw}`;
    return raw;
  }
}

function requestSilentViaExtension(opts: {
  downloadUrl: string;
  filename: string;
  kind: "video" | "audio" | "subtitles";
  title?: string;
  videoId?: string;
  videoUrl?: string;
  quality?: string;
  thumbnail?: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const onMsg = (event: MessageEvent) => {
      if (event.source !== window) return;
      if (
        event.data?.source !== "nova-extension" ||
        event.data?.type !== "NOVA_SILENT_DOWNLOAD_RESULT"
      ) {
        return;
      }
      window.removeEventListener("message", onMsg);
      window.clearTimeout(timer);
      resolve(Boolean(event.data.ok));
    };
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMsg);
      resolve(false);
    }, 8000);
    window.addEventListener("message", onMsg);
    window.postMessage(
      {
        source: "nova-site",
        type: "NOVA_SILENT_DOWNLOAD",
        ...opts,
      },
      "*",
    );
  });
}

function anchorDownload(downloadUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = downloadUrl;
  a.download = filename || "download";
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export type SilentDownloadOptions = {
  downloadUrl: string;
  filename: string;
  kind: "video" | "audio" | "subtitles";
  title?: string;
  videoId?: string;
  videoUrl?: string;
  quality?: string;
  thumbnail?: string;
};

/**
 * Prefer extension silent download (no Save As, correct folders).
 * Otherwise trigger a same-origin navigation/download.
 */
export async function startBrowserDownload(
  downloadUrlOrOpts: string | SilentDownloadOptions,
  legacyFilename?: string,
  legacyKind?: "video" | "audio" | "subtitles",
): Promise<void> {
  const opts: SilentDownloadOptions =
    typeof downloadUrlOrOpts === "string"
      ? {
          downloadUrl: downloadUrlOrOpts,
          filename: legacyFilename || "download",
          kind: legacyKind || "video",
        }
      : downloadUrlOrOpts;

  const url = resolveDownloadUrl(String(opts.downloadUrl || "").trim());
  if (!url) return;

  if (extensionInstalled()) {
    const ok = await requestSilentViaExtension({ ...opts, downloadUrl: url });
    if (ok) return;
  }

  anchorDownload(url, opts.filename);
}

/** @deprecated Prefer startBrowserDownload with prepare stream URLs. */
export function downloadFile(
  jobId: string,
  filename: string,
  onError: () => void,
) {
  void filename;
  void onError;
  void startBrowserDownload({
    downloadUrl: `/api/jobs/${encodeURIComponent(jobId)}/file`,
    filename: filename || "download",
    kind: "video",
  });
}
