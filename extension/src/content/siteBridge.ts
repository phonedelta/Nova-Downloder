/** Voluntary handshake + silent downloads with the NovaDownloader website. */
import { browserApi } from "../utils/browserApi";

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== "nova-site") return;

  if (data.type === "NOVA_EXTENSION_PING") {
    document.documentElement.dataset.novaExtension = "1";
    window.postMessage(
      { source: "nova-extension", type: "NOVA_EXTENSION_PONG" },
      "*",
    );
    return;
  }

  if (data.type === "NOVA_SILENT_DOWNLOAD") {
    void (async () => {
      try {
        const res = (await browserApi.sendMessage({
          type: "SILENT_STREAM_DOWNLOAD",
          downloadUrl: String(data.downloadUrl || ""),
          filename: String(data.filename || "download"),
          kind:
            data.kind === "audio" || data.kind === "subtitles"
              ? data.kind
              : "video",
          title: data.title ? String(data.title) : undefined,
          videoId: data.videoId ? String(data.videoId) : undefined,
          videoUrl: data.videoUrl ? String(data.videoUrl) : undefined,
          quality: data.quality ? String(data.quality) : undefined,
          thumbnail: data.thumbnail ? String(data.thumbnail) : undefined,
        })) as { type?: string; jobId?: string; error?: string };
        window.postMessage(
          {
            source: "nova-extension",
            type: "NOVA_SILENT_DOWNLOAD_RESULT",
            ok: res?.type === "DOWNLOAD_STARTED",
            jobId: res?.type === "DOWNLOAD_STARTED" ? res.jobId : undefined,
            error: res?.type === "DOWNLOAD_ERROR" ? res.error : undefined,
          },
          "*",
        );
      } catch (e) {
        window.postMessage(
          {
            source: "nova-extension",
            type: "NOVA_SILENT_DOWNLOAD_RESULT",
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          },
          "*",
        );
      }
    })();
  }
});

document.documentElement.dataset.novaExtension = "1";
