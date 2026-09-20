import { createRoot, type Root } from "react-dom/client";
import { useEffect, useMemo, useState } from "react";
import { browserApi } from "../../utils/browserApi";
import {
  badgeForHeight,
  formatBytesShort,
  qualityLabel,
  type GenericFormat,
} from "../../services/genericMediaAnalyzer";
import type { DetectedMediaSource, DetectedWebVideo } from "./webVideoDetector";
import { ensureGenericStyles } from "./genericVideoButton";
import { collectSniffedMedia, sniffFormatsForPanel } from "./mediaSniffer";

type Props = {
  info: DetectedWebVideo;
  anchor: DOMRect;
  onClose: () => void;
};

function domainOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function sanitizeName(title: string): string {
  return (
    title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").trim().slice(0, 100) || "media"
  );
}

function sourcesToFormats(sources: DetectedMediaSource[]): GenericFormat[] {
  const byH = new Map<number, GenericFormat>();
  sources.forEach((s, i) => {
    const height = s.height && s.height > 0 ? s.height : 0;
    const key = height || 10_000 + i;
    if (byH.has(key)) return;
    byH.set(key, {
      id: `direct:${i}`,
      height: height || 0,
      url: s.url,
      ext: "mp4",
      codec: "unknown",
      hasAudio: true,
      estimatedSize: null,
      displaySize: null,
      sizeEstimated: true,
      resolution: height ? `${height}p` : "best",
    });
  });
  return Array.from(byH.values()).sort((a, b) => b.height - a.height);
}

function isYtDlpFormatId(id: string): boolean {
  return Boolean(id) && !/^(direct|prog|hls):/i.test(id);
}

function GenericPanelApp({ info, anchor, onClose }: Props) {
  const [tab, setTab] = useState<"video" | "audio">("video");
  const [formats, setFormats] = useState<GenericFormat[]>([]);
  const [resolvedMediaUrl, setResolvedMediaUrl] = useState(
    info.sources[0]?.url || "",
  );
  const [title, setTitle] = useState(info.title);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const mediaUrl = info.sources[0]?.url || "";
  const needProbe =
    Boolean(info.preferYtDlp) ||
    info.sources.every((s) => !s.height) ||
    info.sources.length <= 1;

  const blocked =
    Boolean(info.unsupportedReason) || (!mediaUrl && info.sources.length === 0);

  const top = Math.min(
    anchor.bottom + 8,
    Math.max(8, window.innerHeight - 420),
  );
  const left = Math.min(
    Math.max(8, anchor.right - 320),
    window.innerWidth - 328,
  );

  const hostname = useMemo(() => domainOf(info.pageUrl), [info.pageUrl]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      if (blocked) {
        setLoading(false);
        return;
      }

      try {
        const local = await sniffFormatsForPanel();
        if (
          !cancelled &&
          local.formats.some((f) => f.height > 0) &&
          local.formats.length > 0
        ) {
          setFormats(local.formats);
          setResolvedMediaUrl(local.mediaUrl || mediaUrl);
          setLoading(false);
          return;
        }
      } catch {
        /* continue */
      }

      if (!needProbe && info.sources.some((s) => s.height)) {
        if (!cancelled) {
          setFormats(sourcesToFormats(info.sources));
          setResolvedMediaUrl(mediaUrl);
          setLoading(false);
        }
        return;
      }

      const sniffed = collectSniffedMedia().map((m) => m.url);
      try {
        const response = (await browserApi.sendMessage({
          type: "ANALYZE_GENERIC",
          payload: {
            mediaUrl,
            pageUrl: info.pageUrl,
            title: info.title,
            candidateUrls: sniffed,
          },
        })) as {
          type: string;
          data?: {
            title?: string;
            mediaUrl?: string;
            formats: GenericFormat[];
          };
          error?: string;
        };
        if (cancelled) return;
        if (response.type === "ANALYZE_GENERIC_SUCCESS" && response.data) {
          setFormats(response.data.formats || []);
          if (response.data.title) setTitle(response.data.title);
          if (response.data.mediaUrl) {
            setResolvedMediaUrl(response.data.mediaUrl);
          }
        } else {
          const localFallback = sourcesToFormats(info.sources);
          if (localFallback.length) setFormats(localFallback);
          else {
            setError(
              response.error ||
                "Lancez la lecture une seconde, puis rouvrez Nova.",
            );
          }
        }
      } catch {
        if (!cancelled) {
          const localFallback = sourcesToFormats(info.sources);
          if (localFallback.length) setFormats(localFallback);
          else {
            setError("Lancez la lecture une seconde, puis rouvrez Nova.");
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [blocked, info.pageUrl, info.preferYtDlp, info.title, mediaUrl, needProbe]);

  async function startVideo(format: GenericFormat) {
    setBusyId(format.id);
    setError("");
    setToast("");
    try {
      const name = sanitizeName(title);
      const quality =
        format.height > 0
          ? qualityLabel(format.height)
          : "Meilleure qualité";
      const downloadUrl = format.url || resolvedMediaUrl || mediaUrl;
      if (!downloadUrl) {
        setError("Source vidéo non prise en charge.");
        return;
      }
      const preferYtDlp =
        Boolean(info.preferYtDlp) ||
        /\.m3u8(\?|#|$)/i.test(downloadUrl) ||
        !/\.(mp4|webm|m4v|mov|mkv)(\?|#|$)/i.test(downloadUrl);
      const hlsUrl = /\.m3u8(\?|#|$)/i.test(downloadUrl);
      const ytId = isYtDlpFormatId(format.id);

      const response = (await browserApi.sendMessage({
        type: "START_GENERIC_DOWNLOAD",
        payload: {
          mediaUrl: downloadUrl,
          pageUrl: info.pageUrl,
          title,
          downloadType: "video",
          quality,
          container: "mp4",
          filename: `${name}.mp4`,
          // HLS variant URL already IS the quality — don't re-filter by height
          height:
            !hlsUrl && format.height > 0 ? format.height : undefined,
          preferYtDlp,
          formatId: ytId ? format.id : undefined,
          audioFormatId: ytId ? format.audioFormatId : undefined,
        },
      })) as { type: string; error?: string };

      if (response.type === "DOWNLOAD_ERROR") {
        setError(response.error || "Cette vidéo ne peut pas être téléchargée.");
        return;
      }
      setToast("Téléchargement lancé.");
      window.setTimeout(() => onClose(), 900);
    } catch {
      setError("Impossible de contacter NovaDownloader.");
    } finally {
      setBusyId(null);
    }
  }

  async function startAudio() {
    setBusyId("audio");
    setError("");
    setToast("");
    try {
      const name = sanitizeName(title);
      const downloadUrl = resolvedMediaUrl || mediaUrl;
      const response = (await browserApi.sendMessage({
        type: "START_GENERIC_DOWNLOAD",
        payload: {
          mediaUrl: downloadUrl,
          pageUrl: info.pageUrl,
          title,
          downloadType: "audio",
          quality: "MP3",
          container: "mp3",
          filename: `${name}.mp3`,
          preferYtDlp: true,
        },
      })) as { type: string; error?: string };

      if (response.type === "DOWNLOAD_ERROR") {
        setError(response.error || "Cette vidéo ne peut pas être téléchargée.");
        return;
      }
      setToast("Téléchargement lancé.");
      window.setTimeout(() => onClose(), 900);
    } catch {
      setError("Impossible de contacter NovaDownloader.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      className="nova-generic-panel-host"
      role="dialog"
      aria-label="NovaDownloader"
      style={{ top, left }}
    >
      <div className="nova-generic-panel-header">
        <h3>NovaDownloader</h3>
        <button
          type="button"
          className="nova-generic-panel-close"
          aria-label="Fermer"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <p className="nova-generic-panel-meta">
        {title}
        <br />
        {hostname}
      </p>

      {blocked ? (
        <div className="nova-generic-body">
          <p className="nova-generic-error">
            {info.unsupportedReason || "Source vidéo non prise en charge."}
          </p>
        </div>
      ) : (
        <>
          <div className="nova-generic-tabs" role="tablist">
            <button
              type="button"
              className="nova-generic-tab"
              role="tab"
              aria-selected={tab === "video"}
              onClick={() => setTab("video")}
            >
              Vidéo
            </button>
            <button
              type="button"
              className="nova-generic-tab"
              role="tab"
              aria-selected={tab === "audio"}
              onClick={() => setTab("audio")}
            >
              MP3
            </button>
          </div>
          <div className="nova-generic-body">
            {tab === "video" ? (
              loading ? (
                <p className="nova-generic-hint">Analyse des qualités…</p>
              ) : formats.length === 0 ? (
                <p className="nova-generic-error">
                  {error ||
                    "Lancez la lecture une seconde, puis rouvrez Nova."}
                </p>
              ) : (
                formats.map((f) => {
                  const badge = f.height ? badgeForHeight(f.height) : null;
                  const size = formatBytesShort(
                    f.displaySize ?? f.estimatedSize,
                  );
                  const busy = busyId === f.id;
                  return (
                    <div className="nova-generic-format-row" key={f.id}>
                      <div className="nova-generic-format-main">
                        <div className="nova-generic-format-title">
                          <strong>
                            {f.height > 0 ? `${f.height}p` : "Meilleure"}
                          </strong>
                          {badge ? (
                            <span className="nova-generic-chip">{badge}</span>
                          ) : null}
                        </div>
                        <p className="nova-generic-format-meta">
                          {[
                            f.height > 0
                              ? qualityLabel(f.height)
                              : "Meilleure qualité",
                            "MP4",
                            size,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="nova-generic-format-dl"
                        disabled={Boolean(busyId)}
                        aria-label={`Télécharger ${f.height || ""}p`}
                        onClick={() => void startVideo(f)}
                      >
                        {busy ? "…" : "↓"}
                      </button>
                    </div>
                  );
                })
              )
            ) : (
              <>
                <p className="nova-generic-hint">
                  Meilleure qualité disponible · MP3
                </p>
                <button
                  type="button"
                  className="nova-generic-download"
                  disabled={
                    Boolean(busyId) ||
                    loading ||
                    !(resolvedMediaUrl || mediaUrl)
                  }
                  onClick={() => void startAudio()}
                >
                  {busyId === "audio" ? "…" : "Télécharger MP3"}
                </button>
              </>
            )}
            {error && (tab === "audio" || formats.length > 0) ? (
              <p className="nova-generic-error">{error}</p>
            ) : null}
            {toast ? <p className="nova-generic-hint">{toast}</p> : null}
          </div>
        </>
      )}
    </div>
  );
}

let panelRoot: Root | null = null;
let panelHost: HTMLElement | null = null;

export function openGenericPanel(
  info: DetectedWebVideo,
  anchorEl: HTMLElement,
): void {
  ensureGenericStyles();
  closeGenericPanel();

  const rect = anchorEl.getBoundingClientRect();
  panelHost = document.createElement("div");
  panelHost.setAttribute("data-nova-generic-panel", "true");
  document.documentElement.appendChild(panelHost);
  panelRoot = createRoot(panelHost);

  const onDoc = (e: MouseEvent) => {
    const t = e.target as Node;
    if (panelHost?.contains(t) || anchorEl.contains(t)) return;
    closeGenericPanel();
  };
  window.setTimeout(() => {
    document.addEventListener("mousedown", onDoc, true);
  }, 0);
  (panelHost as HTMLElement & { _novaClose?: () => void })._novaClose = () => {
    document.removeEventListener("mousedown", onDoc, true);
  };

  panelRoot.render(
    <GenericPanelApp
      info={info}
      anchor={rect}
      onClose={closeGenericPanel}
    />,
  );
}

export function closeGenericPanel(): void {
  if (panelHost) {
    const closer = (
      panelHost as HTMLElement & { _novaClose?: () => void }
    )._novaClose;
    closer?.();
  }
  panelRoot?.unmount();
  panelRoot = null;
  panelHost?.remove();
  panelHost = null;
}
