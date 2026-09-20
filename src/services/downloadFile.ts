/**
 * Start a download without a Save As dialog when the NovaDownloader
 * extension is present (chrome.downloads + saveAs:false + folders).
 * Falls back to a hidden iframe for browsers without the extension.
 */

function extensionInstalled(): boolean {
  return document.documentElement.dataset.novaExtension === "1";
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

function iframeFallback(downloadUrl: string) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  iframe.style.cssText =
    "position:fixed;width:0;height:0;border:0;visibility:hidden;pointer-events:none";
  iframe.src = downloadUrl;
  document.body.append(iframe);
  window.setTimeout(() => {
    try {
      iframe.remove();
    } catch {
      /* already gone */
    }
  }, 120_000);
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
 * Otherwise fall back to iframe (browser may still prompt if Chrome
 * setting "Ask where to save each file" is enabled).
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

  const url = String(opts.downloadUrl || "").trim();
  if (!url) return;

  if (extensionInstalled()) {
    const ok = await requestSilentViaExtension(opts);
    if (ok) return;
  }

  iframeFallback(url);
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
