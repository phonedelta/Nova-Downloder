import { Download, LoaderCircle } from "lucide-react";
import {
  displayFileSize,
  qualityLabel,
  type Analysis,
  type VideoFormat,
} from "@nova/shared";
import type { Locale } from "../i18n";
import { t } from "../i18n";

type Props = {
  data: Analysis;
  locale: Locale;
  busyId: string | null;
  buttonLabel: (id: string) => string;
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

export function VideoTab({
  data,
  locale,
  busyId,
  buttonLabel,
  onDownload,
}: Props) {
  const formats = pickFormats(data.formats);
  if (!formats.length) {
    return <p className="nova-hint">{t("Aucun format vidéo disponible.", locale)}</p>;
  }

  return (
    <div>
      {formats.map((f) => {
        const label = qualityLabel(f.height);
        const busy = busyId === f.id;
        return (
          <div className="nova-format" key={f.id}>
            <div className="nova-format-info">
              <strong>
                {f.height >= 2160
                  ? `${label} ${f.height}p`
                  : `${f.height}p${label ? ` ${label}` : ""}`}
              </strong>
              <div className="nova-format-meta">
                <span>{f.ext === "mp4" ? "MP4" : "MKV"}</span>
                <span>{f.fps ? `${f.fps} FPS` : "—"}</span>
                <span>
                  {displayFileSize(f.displaySize, f.sizeEstimated) ===
                  "Non disponible"
                    ? t("Non disponible", locale)
                    : displayFileSize(f.displaySize, f.sizeEstimated)}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="nova-action"
              disabled={busy}
              aria-label={`${t("Télécharger", locale)} ${f.height}p`}
              onClick={() => onDownload(f)}
            >
              {busy ? (
                <LoaderCircle size={16} className="nova-spin" aria-hidden />
              ) : (
                <Download size={16} aria-hidden />
              )}
              {buttonLabel(f.id)}
            </button>
          </div>
        );
      })}
    </div>
  );
}
