import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownToLine,
  Captions,
  ChevronRight,
  ExternalLink,
  Music2,
  Video,
  X,
} from "lucide-react";
import {
  duration,
  type Analysis,
  type DownloadJob,
  type VideoFormat,
} from "@nova/shared";
import { browserApi } from "../utils/browserApi";
import { webUrlWithVideo } from "../services/novaApi";
import type { ExtensionResponse } from "../types/api";
import { detectLocale, isRtl, t, type Locale } from "../i18n";
import { useDownloadStore } from "../hooks/useDownloadStore";
import {
  audioPayload,
  createDownloadSnapshot,
  subtitlePayload,
  videoPayloadFromFormat,
  type StartDownloadPayload,
} from "../downloads/downloadSnapshot";
import {
  ensurePanelLayer,
  getPanelAnchor,
  removePanelLayer,
} from "../content/panelPortal";
import { LoadingState } from "./LoadingState";
import { ErrorState } from "./ErrorState";
import { VideoTab } from "./VideoTab";
import { AudioTab } from "./AudioTab";
import { SubtitleTab } from "./SubtitleTab";
import { DownloadsScreen } from "./DownloadsScreen";

type Props = {
  videoId: string;
  videoUrl: string;
  pageTitle: string | null;
  theme: "light" | "dark";
  localeHint?: string;
  isShorts?: boolean;
  onClose: () => void;
  onActiveCountChange?: (count: number) => void;
};

type TabId = "video" | "audio" | "subtitles";

const DEBOUNCE_MS = 400;

export function DownloadPanel({
  videoId,
  videoUrl,
  pageTitle,
  theme,
  localeHint,
  isShorts,
  onClose,
  onActiveCountChange,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);
  const [anchor, setAnchor] = useState(() => getPanelAnchor());
  const [locale] = useState<Locale>(() => detectLocale(localeHint));
  const [state, setState] = useState<"idle" | "analyzing" | "ready" | "error">(
    "idle",
  );
  const [data, setData] = useState<Analysis | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabId>("video");
  const [bitrate, setBitrate] = useState("0");
  const [trackId, setTrackId] = useState("");
  const [target, setTarget] = useState("");
  const [preparingKey, setPreparingKey] = useState<string | null>(null);
  const [buttonState, setButtonState] = useState<
    Record<string, "idle" | "preparing" | "started">
  >({});
  const [view, setView] = useState<"home" | "downloads">("home");
  const [toast, setToast] = useState("");
  const analysisGen = useRef(0);
  const lastStartRef = useRef<{ key: string; at: number } | null>(null);

  const { downloads, mergeJob, refresh, removeLocal, activeCount } =
    useDownloadStore(onActiveCountChange);

  useEffect(() => {
    const gen = ++analysisGen.current;
    setData(null);
    setError("");
    setState("analyzing");
    setPreparingKey(null);
    setButtonState({});

    void (async () => {
      try {
        const response = (await browserApi.sendMessage({
          type: "ANALYZE_VIDEO",
          url: videoUrl,
          videoId,
        })) as ExtensionResponse;
        if (analysisGen.current !== gen) return;
        if (response.type === "ANALYZE_SUCCESS") {
          if (response.videoId !== videoId) return;
          setData(response.data);
          setTrackId(response.data.subtitles[0]?.id || "");
          setState("ready");
        } else if (response.type === "ANALYZE_ERROR") {
          if (response.videoId !== videoId) return;
          setError(response.error);
          setState("error");
        } else {
          setError(
            t("Cette vidéo ne peut pas être analysée actuellement.", locale),
          );
          setState("error");
        }
      } catch {
        if (analysisGen.current !== gen) return;
        setError(t("Impossible de contacter NovaDownloader.", locale));
        setState("error");
      }
    })();
  }, [videoId, videoUrl, locale]);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // Render outside the YouTube player so overflow:hidden cannot clip the popup.
  // Re-anchor when the button is dragged so the panel stays under it.
  useEffect(() => {
    const mount = ensurePanelLayer();
    setPortalEl(mount);
    const sync = () => setAnchor(getPanelAnchor());
    sync();
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(sync)
        : null;
    const mo =
      typeof MutationObserver !== "undefined"
        ? new MutationObserver(sync)
        : null;
    const host = document.getElementById("novadownloader-host");
    if (host && ro) ro.observe(host);
    if (host && mo) {
      mo.observe(host, {
        attributes: true,
        attributeFilter: ["style", "class", "data-dragged"],
      });
    }
    const tick = window.setInterval(sync, 500);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
      window.clearInterval(tick);
      ro?.disconnect();
      mo?.disconnect();
      removePanelLayer();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (view === "downloads") {
        setView("home");
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose, view]);

  useEffect(() => {
    const onPointer = (e: MouseEvent) => {
      const path = e.composedPath();
      if (panelRef.current && path.includes(panelRef.current)) return;
      if (
        path.some(
          (n) =>
            n instanceof Element &&
            (n.getAttribute?.("data-novadownloader-button") === "true" ||
              n.getAttribute?.("data-novadownloader-host") === "true"),
        )
      )
        return;
      onClose();
    };
    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", onPointer, true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onPointer, true);
    };
  }, [onClose]);

  function setBtn(key: string, value: "idle" | "preparing" | "started") {
    setButtonState((prev) => ({ ...prev, [key]: value }));
  }

  function labelFor(key: string, idle: string): string {
    const s = buttonState[key] || "idle";
    if (s === "preparing") return t("Préparation...", locale);
    if (s === "started") return t("Téléchargement lancé", locale);
    return idle;
  }

  const startDownload = useCallback(
    async (key: string, payload: StartDownloadPayload) => {
      const now = Date.now();
      const last = lastStartRef.current;
      if (last && last.key === key && now - last.at < DEBOUNCE_MS) return;
      lastStartRef.current = { key, at: now };

      const snapshot = createDownloadSnapshot(payload);
      setPreparingKey(key);
      setBtn(key, "preparing");
      setView("downloads");

      try {
        const response = (await browserApi.sendMessage({
          type: "START_DOWNLOAD",
          payload: snapshot,
        })) as ExtensionResponse;

        if (response.type === "DOWNLOAD_STARTED") {
          if (response.job) mergeJob(response.job);
          setBtn(key, "started");
          setToast(
            "Téléchargement lancé. Vous pouvez fermer NovaDownloader, le téléchargement continuera dans votre navigateur.",
          );
          window.setTimeout(() => setToast(""), 4500);
          window.setTimeout(() => setBtn(key, "idle"), 2500);
          void refresh();
        } else if (response.type === "DOWNLOAD_ERROR") {
          setError(response.error);
          setBtn(key, "idle");
        } else {
          setBtn(key, "idle");
        }
      } catch {
        setError(t("Impossible de contacter NovaDownloader.", locale));
        setBtn(key, "idle");
      } finally {
        setPreparingKey((k) => (k === key ? null : k));
      }
    },
    [locale, mergeJob, refresh],
  );

  const retryJob = useCallback(
    (job: DownloadJob) => {
      void browserApi.sendMessage({ type: "DISMISS_DOWNLOAD", jobId: job.id });
      removeLocal(job.id);
      const baseName = job.filename.split(/[/\\]/).pop() || job.filename;
      if (job.type === "video" && job.formatId) {
        void startDownload(`retry-${job.id}`, {
          videoId: job.videoId,
          videoUrl: job.videoUrl || "",
          title: job.title,
          channel: job.channel,
          thumbnail: job.thumbnail,
          downloadType: "video",
          quality: job.quality,
          formatId: job.formatId,
          audioFormatId: job.audioFormatId,
          resolution: job.resolution,
          fps: job.fps,
          container: job.container || job.format,
          codec: job.codec,
          estimatedSize: job.estimatedTotalBytes,
          filename: baseName,
        });
      } else if (job.type === "audio") {
        void startDownload(
          `retry-${job.id}`,
          audioPayload({
            videoId: job.videoId,
            videoUrl: job.videoUrl || "",
            title: job.title,
            channel: job.channel,
            thumbnail: job.thumbnail,
            bitrate: job.bitrate || "0",
          }),
        );
      } else if (job.type === "subtitle" && job.language) {
        void startDownload(
          `retry-${job.id}`,
          subtitlePayload({
            videoId: job.videoId,
            videoUrl: job.videoUrl || "",
            title: job.title,
            channel: job.channel,
            thumbnail: job.thumbnail,
            language: job.language,
            targetLanguage: job.targetLanguage,
            langLabel: job.quality || job.language,
          }),
        );
      }
    },
    [removeLocal, startDownload],
  );

  async function analyzeRetry() {
    const gen = ++analysisGen.current;
    setState("analyzing");
    setError("");
    try {
      const response = (await browserApi.sendMessage({
        type: "ANALYZE_VIDEO",
        url: videoUrl,
        videoId,
      })) as ExtensionResponse;
      if (analysisGen.current !== gen) return;
      if (response.type === "ANALYZE_SUCCESS") {
        setData(response.data);
        setTrackId(response.data.subtitles[0]?.id || "");
        setState("ready");
      } else if (response.type === "ANALYZE_ERROR") {
        setError(response.error);
        setState("error");
      }
    } catch {
      if (analysisGen.current !== gen) return;
      setError(t("Impossible de contacter NovaDownloader.", locale));
      setState("error");
    }
  }

  const title = data?.video.title || pageTitle || "YouTube";
  const thumbnail = data?.video.thumbnail;

  const tabs = useMemo(
    () => [
      { id: "video" as const, label: t("Vidéo", locale), Icon: Video },
      { id: "audio" as const, label: "MP3", Icon: Music2 },
      {
        id: "subtitles" as const,
        label: t("Sous-titres", locale),
        Icon: Captions,
      },
    ],
    [locale],
  );

  const panel = (
    <div
      className="nova-root"
      data-theme={theme}
      data-shorts={isShorts ? "true" : undefined}
      dir={isRtl(locale) ? "rtl" : "ltr"}
      style={{ pointerEvents: "none" }}
    >
      <div
        ref={panelRef}
        className="nova-panel nova-panel--portal"
        role="dialog"
        aria-modal="true"
        aria-label={t("Télécharger cette vidéo", locale)}
        tabIndex={-1}
        data-theme={theme}
        dir={isRtl(locale) ? "rtl" : "ltr"}
        data-shorts={isShorts ? "true" : undefined}
        style={
          {
            "--nova-panel-top": `${anchor.top}px`,
            "--nova-panel-right": `${anchor.right}px`,
            "--nova-panel-max-height": `${anchor.maxHeight}px`,
            pointerEvents: "auto",
          } as CSSProperties
        }
      >
      <div className="nova-panel-header">
        <span className="nova-logo" aria-hidden>
          <ArrowDownToLine size={18} />
        </span>
        <h2>NovaDownloader</h2>
        <button
          type="button"
          className="nova-icon-btn"
          aria-label={t("Fermer", locale)}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>

      {toast ? <p className="nova-toast">{toast}</p> : null}

      {view === "downloads" ? (
        <DownloadsScreen
          locale={locale}
          downloads={downloads}
          onBack={() => setView("home")}
          onPause={(job) =>
            void browserApi.sendMessage({
              type: "PAUSE_DOWNLOAD",
              jobId: job.id,
              chromeDownloadId: job.chromeDownloadId,
            })
          }
          onResume={(job) =>
            void browserApi.sendMessage({
              type: "RESUME_DOWNLOAD",
              jobId: job.id,
              chromeDownloadId: job.chromeDownloadId,
            })
          }
          onCancel={(job) =>
            void browserApi.sendMessage({
              type: "CANCEL_DOWNLOAD",
              jobId: job.id,
              chromeDownloadId: job.chromeDownloadId,
            })
          }
          onDismiss={(id) => {
            void browserApi.sendMessage({
              type: "DISMISS_DOWNLOAD",
              jobId: id,
            });
            removeLocal(id);
          }}
          onRetry={retryJob}
        />
      ) : (
        <>
          <button
            type="button"
            className="nova-dl-entry"
            onClick={() => setView("downloads")}
            aria-label={
              activeCount > 0
                ? `${t("Téléchargements", locale)} (${activeCount})`
                : t("Téléchargements", locale)
            }
          >
            <span className="nova-dl-entry-label">
              <ArrowDownToLine size={15} aria-hidden />
              {t("Téléchargements", locale)}
              {activeCount > 0 ? (
                <span className="nova-dl-entry-badge">{activeCount}</span>
              ) : null}
            </span>
            <ChevronRight size={16} aria-hidden />
          </button>

          {state === "analyzing" || state === "idle" ? (
            <div className="nova-body">
              <LoadingState label={t("Analyse de la vidéo…", locale)} />
            </div>
          ) : state === "error" ? (
            <div className="nova-body">
              <ErrorState
                message={
                  error.includes("contacter")
                    ? t("Impossible de contacter NovaDownloader.", locale)
                    : error
                }
                retryLabel={t("Réessayer", locale)}
                onRetry={() => void analyzeRetry()}
              />
            </div>
          ) : data ? (
            <>
              <div className="nova-preview">
                <img className="nova-thumb" src={data.video.thumbnail} alt="" />
                <div className="nova-preview-meta">
                  <h3 dir="auto">{data.video.title}</h3>
                  <p>
                    {data.video.channel}
                    {data.video.duration
                      ? ` · ${duration(data.video.duration)}`
                      : ""}
                  </p>
                </div>
              </div>

              <div className="nova-tabs" role="tablist">
                {tabs.map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    className="nova-tab"
                    aria-selected={tab === id}
                    onClick={() => setTab(id)}
                  >
                    <Icon size={15} aria-hidden />
                    {label}
                  </button>
                ))}
              </div>

              <div className="nova-body" role="tabpanel">
                {tab === "video" ? (
                  <VideoTab
                    data={data}
                    locale={locale}
                    busyId={preparingKey}
                    buttonLabel={(id) =>
                      labelFor(id, t("Télécharger", locale))
                    }
                    onDownload={(format: VideoFormat) =>
                      void startDownload(
                        format.id,
                        videoPayloadFromFormat({
                          videoId,
                          videoUrl,
                          title,
                          channel: data.video.channel,
                          thumbnail,
                          format,
                        }),
                      )
                    }
                  />
                ) : tab === "audio" ? (
                  <AudioTab
                    locale={locale}
                    bitrate={bitrate}
                    onBitrateChange={setBitrate}
                    busy={preparingKey === "audio"}
                    buttonText={labelFor(
                      "audio",
                      t("Télécharger MP3", locale),
                    )}
                    onDownload={() =>
                      void startDownload(
                        "audio",
                        audioPayload({
                          videoId,
                          videoUrl,
                          title,
                          channel: data.video.channel,
                          thumbnail,
                          bitrate,
                        }),
                      )
                    }
                  />
                ) : (
                  <SubtitleTab
                    data={data}
                    locale={locale}
                    trackId={trackId}
                    target={target}
                    onTrackChange={setTrackId}
                    onTargetChange={setTarget}
                    busy={preparingKey === "sub"}
                    buttonText={labelFor(
                      "sub",
                      t("Télécharger SRT", locale),
                    )}
                    onDownload={() => {
                      const track = data.subtitles.find(
                        (s) => s.id === trackId,
                      );
                      const lang = target || track?.language || "sub";
                      void startDownload(
                        "sub",
                        subtitlePayload({
                          videoId,
                          videoUrl,
                          title,
                          channel: data.video.channel,
                          thumbnail,
                          language: trackId,
                          targetLanguage: target || undefined,
                          langLabel: lang,
                        }),
                      );
                    }}
                  />
                )}
              </div>

              <div className="nova-footer">
                <a
                  className="nova-external"
                  href={webUrlWithVideo(videoUrl)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("Plus d’options sur NovaDownloader", locale)}
                  <ExternalLink size={12} aria-hidden />
                </a>
                <p className="nova-legal">
                  {t(
                    "Respectez les droits d’auteur et les conditions d’utilisation applicables.",
                    locale,
                  )}
                </p>
              </div>
            </>
          ) : null}
        </>
      )}
      </div>
    </div>
  );

  if (!portalEl) return null;
  return createPortal(panel, portalEl);
}
