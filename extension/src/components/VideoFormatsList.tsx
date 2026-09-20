import { Download, LoaderCircle } from "lucide-react";
import {
  displayFileSize,
  isActiveDownloadState,
  qualityLabel,
  type DownloadJob,
  type VideoFormat,
} from "@nova/shared";
import type { Locale } from "../i18n";
import { t } from "../i18n";

type Props = {
  formats: VideoFormat[];
  locale: Locale;
  preferredHeight?: string;
  busyId: string | null;
  buttonLabel: (id: string) => string;
  activeJobs: DownloadJob[];
  onDownload: (format: VideoFormat) => void;
};

function pickFormats(formats: VideoFormat[]): VideoFormat[] {
  return Array.from(new Set(formats.map((f) => f.height)))
    .sort((a, b) => b - a)
    .map(
      (height) =>
        formats
          .filter((f) => f.height === height)
          .sort(
            (a, b) =>
              Number(b.ext === "mp4") - Number(a.ext === "mp4") ||
              Number(b.codec.startsWith("avc")) -
                Number(a.codec.startsWith("avc")) ||
              (b.fps || 0) - (a.fps || 0) ||
              Number(!!(b.filesize || b.filesizeApprox)) -
                Number(!!(a.filesize || a.filesizeApprox)),
          )[0],
    );
}

function badgeFor(height: number): string | null {
  if (height >= 2160) return "4K";
  if (height >= 1080) return "Full HD";
  if (height >= 720) return "HD";
  return null;
}

export function VideoFormatsList({
  formats,
  locale,
  preferredHeight,
  busyId,
  buttonLabel,
  activeJobs,
  onDownload,
}: Props) {
  const rows = pickFormats(formats);
  if (!rows.length) {
    return (
      <p className="nova-hint">{t("Aucun format vidéo disponible.", locale)}</p>
    );
  }

  return (
    <div className="nova-format-list">
      {rows.map((f) => {
        const busy = busyId === f.id;
        const ql = qualityLabel(f.height);
        const badge = badgeFor(f.height);
        const preferred =
          preferredHeight &&
          preferredHeight !== "best" &&
          String(f.height) === preferredHeight;
        const activeJob = activeJobs.find(
          (j) =>
            j.type === "video" &&
            j.formatId === f.id &&
            isActiveDownloadState(j.state),
        );
        const size = displayFileSize(f.displaySize, f.sizeEstimated);
        const sizeLabel =
          size === "Non disponible" ? t("Non disponible", locale) : size;

        return (
          <div className="nova-format-row" key={f.id}>
            <div className="nova-format-row-main">
              <div className="nova-format-row-title">
                <strong>{f.height}p</strong>
                {badge ? <span className="nova-chip">{badge}</span> : null}
                {f.fps && f.fps >= 50 ? (
                  <span className="nova-chip">{f.fps} FPS</span>
                ) : null}
                {preferred ? (
                  <span className="nova-chip nova-chip--accent">
                    {t("Preferred", locale)}
                  </span>
                ) : null}
                {activeJob ? (
                  <span className="nova-chip nova-chip--live">
                    {typeof activeJob.progress === "number"
                      ? `${Math.round(activeJob.progress)}%`
                      : "…"}
                  </span>
                ) : null}
              </div>
              <p className="nova-format-row-meta">
                {[
                  ql && ql !== `${f.height}p` ? ql : null,
                  f.fps ? `${f.fps} FPS` : null,
                  f.ext === "mp4" ? "MP4" : "MKV",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <p className="nova-format-row-size">{sizeLabel}</p>
            </div>
            <button
              type="button"
              className="nova-action"
              disabled={busy}
              aria-label={`${t("Télécharger", locale)} ${f.height}p`}
              onClick={() => onDownload(f)}
            >
              {busy ? (
                <LoaderCircle size={15} className="nova-spin" aria-hidden />
              ) : (
                <Download size={15} aria-hidden />
              )}
              {buttonLabel(f.id)}
            </button>
          </div>
        );
      })}
    </div>
  );
}
