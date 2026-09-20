import { LoaderCircle, X } from "lucide-react";
import {
  formatBytes,
  formatETA,
  formatSpeed,
} from "../../packages/shared/src/downloadJob";
import { useSmoothNumber } from "../hooks/useSmoothNumber";
import type { ActiveWebDownload } from "../hooks/useDownloads";

type Props = {
  job: ActiveWebDownload;
  onDismiss: (jobId: string) => void;
  t: (value: string) => string;
};

function statusLabel(job: ActiveWebDownload, t: (s: string) => string): string {
  switch (job.state) {
    case "preparing":
      return typeof job.progress === "number" && job.progress > 0
        ? `${t("Préparation…")} ${Math.round(job.progress)}%`
        : t("Préparation…");
    case "starting":
      return t("Démarrage…");
    case "downloading":
      return t("Téléchargement en cours");
    case "completed":
      return t("✓ Terminé");
    case "failed":
      return job.error || t("Échec");
    case "cancelled":
      return t("Annulé");
    default:
      return job.state;
  }
}

export function ActiveDownloadCard({ job, onDismiss, t }: Props) {
  const failed = job.state === "failed" || job.state === "cancelled";
  const completed = job.state === "completed";
  const active =
    job.state === "preparing" ||
    job.state === "starting" ||
    job.state === "downloading";

  const smoothSpeed = useSmoothNumber(
    active ? job.speedBytesPerSecond : null,
    { durationMs: 1100, decimals: 0 },
  );
  const smoothEta = useSmoothNumber(active ? job.etaSeconds : null, {
    durationMs: 1100,
    decimals: 0,
  });
  const smoothPct = useSmoothNumber(
    typeof job.progress === "number" ? job.progress : null,
    { durationMs: 700, decimals: 0 },
  );

  const pct =
    completed
      ? 100
      : smoothPct != null
        ? Math.min(100, Math.max(0, smoothPct))
        : typeof job.progress === "number"
          ? job.progress
          : null;

  const indeterminate =
    active && (pct == null || !Number.isFinite(pct)) && job.state !== "downloading"
      ? true
      : active &&
        job.state === "downloading" &&
        (pct == null || !job.totalBytes || job.totalBytes <= 0);

  const speed =
    smoothSpeed != null && smoothSpeed > 0
      ? `↓ ${formatSpeed(smoothSpeed)}`
      : active
        ? "↓ …"
        : "";

  const eta =
    smoothEta != null && smoothEta >= 0
      ? (() => {
          const formatted = formatETA(smoothEta);
          return formatted ? `~${formatted}` : t("Temps restant : Calcul…");
        })()
      : active
        ? t("Temps restant : Calcul…")
        : "";

  const sizeLine = (() => {
    if (failed) {
      return job.bytesSent > 0
        ? `${formatBytes(job.bytesSent)} ${t("reçus")}`
        : t("Aucune donnée reçue");
    }
    if (completed) {
      const n =
        job.totalBytes && job.totalBytes > 0 ? job.totalBytes : job.bytesSent;
      return n > 0 ? formatBytes(n) : "";
    }
    const left = formatBytes(job.bytesSent || 0);
    if (job.totalBytes && job.totalBytes > 0) {
      return `${left} / ${formatBytes(job.totalBytes)}`;
    }
    if (job.bytesSent > 0) return `${left} ${t("téléchargés")}`;
    if (job.state === "preparing") return t("Préparation du fichier…");
    if (job.state === "starting") return "0 MB";
    return "—";
  })();

  return (
    <article className="web-dl-card" data-state={job.state}>
      <div className="web-dl-top">
        {job.thumbnail ? (
          <img className="web-dl-thumb" src={job.thumbnail} alt="" />
        ) : (
          <div className="web-dl-thumb web-dl-thumb--empty" />
        )}
        <div className="web-dl-main">
          <h4 className="web-dl-title" title={job.title} dir="auto">
            {job.title}
          </h4>
          <p className="web-dl-meta">
            {[job.quality, job.kind === "audio" ? "MP3" : job.kind === "subtitles" ? "SRT" : "MP4"]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {pct != null ? (
          <span className="web-dl-pct">{Math.round(pct)}%</span>
        ) : active ? (
          <LoaderCircle size={18} className="spin web-dl-spin" aria-hidden />
        ) : null}
        <button
          type="button"
          className="web-dl-dismiss"
          aria-label={t("Fermer")}
          onClick={() => onDismiss(job.jobId)}
        >
          <X size={14} />
        </button>
      </div>

      {!failed ? (
        <div
          className={`web-dl-progress${indeterminate ? " web-dl-progress--indeterminate" : ""}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={
            pct != null && !indeterminate ? Math.round(pct) : undefined
          }
        >
          <div
            className="web-dl-progress-value"
            style={
              indeterminate || pct == null
                ? undefined
                : { width: `${Math.min(100, Math.max(0, pct))}%` }
            }
          />
        </div>
      ) : null}

      {!failed ? (
        <div className="web-dl-stats">
          <span>{sizeLine}</span>
          {speed ? <span>{speed}</span> : null}
          {eta && active ? <span>{eta}</span> : null}
        </div>
      ) : null}

      <p
        className={`web-dl-status${failed ? " web-dl-status--error" : ""}${completed ? " web-dl-status--done" : ""}`}
      >
        {statusLabel(job, t)}
      </p>
    </article>
  );
}
