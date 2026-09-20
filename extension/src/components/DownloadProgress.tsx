import type { DownloadJob } from "@nova/shared";
import {
  formatBytes,
  formatETA,
  formatSpeed,
  isActiveDownloadState,
} from "@nova/shared";

type Props = {
  progress: number | null;
  indeterminate?: boolean;
};

/** Determinate bar only when Chrome provides an exact total. */
export function DownloadProgress({ progress, indeterminate }: Props) {
  const known = typeof progress === "number" && Number.isFinite(progress);
  const width = known ? Math.min(100, Math.max(0, progress)) : 0;
  const showIndeterminate = Boolean(indeterminate) || !known;

  return (
    <div
      className={`nova-progress${showIndeterminate ? " nova-progress--indeterminate" : ""}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={known && !showIndeterminate ? Math.round(width) : undefined}
      aria-label="Progression"
    >
      <div
        className="nova-progress-value"
        style={showIndeterminate ? undefined : { width: `${width}%` }}
      />
    </div>
  );
}

export function formatSizePair(job: {
  bytesReceived: number;
  totalBytes: number | null | undefined;
  estimatedTotalBytes?: number | null;
  state: string;
}): string {
  if (
    job.state === "failed" ||
    job.state === "interrupted" ||
    job.state === "cancelled"
  ) {
    if (job.bytesReceived <= 0) return "Aucune donnée reçue";
    return `${formatBytes(job.bytesReceived)} reçus`;
  }

  if (job.state === "completed") {
    const n =
      job.totalBytes && job.totalBytes > 0
        ? job.totalBytes
        : job.bytesReceived;
    return formatBytes(n);
  }

  const received = job.bytesReceived;
  const total = job.totalBytes;
  const left = formatBytes(received);
  if (typeof total === "number" && total > 0) {
    return `${left} / ${formatBytes(total)}`;
  }
  if (received > 0) return `${left} téléchargés`;
  if (job.state === "preparing") return "Préparation du fichier…";
  if (job.state === "starting") return "0 MB reçu";
  return "—";
}

export function estimatedSizeHint(job: DownloadJob): string {
  if (job.totalBytes && job.totalBytes > 0) return "";
  if (
    typeof job.estimatedTotalBytes === "number" &&
    job.estimatedTotalBytes > 0 &&
    isActiveDownloadState(job.state)
  ) {
    return `Taille estimée : ~${formatBytes(job.estimatedTotalBytes)}`;
  }
  return "";
}

export function jobStatusLabel(job: DownloadJob): string {
  switch (job.state) {
    case "preparing":
      return typeof job.progress === "number" && job.progress > 0
        ? `Préparation… ${Math.round(job.progress)}%`
        : "Préparation…";
    case "starting":
      return "Démarrage…";
    case "downloading":
      return job.totalBytes && job.totalBytes > 0
        ? "Téléchargement en cours"
        : "Téléchargement en cours";
    case "paused":
      return "En pause";
    case "queued":
      return "En attente";
    case "completed":
      return "✓ Terminé";
    case "interrupted":
      return job.error || "Interrompu";
    case "cancelled":
      return "Annulé";
    case "failed":
      return job.error || "Échec";
    default:
      return "";
  }
}

export function jobMetaLine(job: DownloadJob): string {
  const parts: string[] = [];
  if (job.quality) parts.push(job.quality);
  if (job.format) parts.push(job.format.toUpperCase());
  else if (job.type === "audio") parts.push("MP3");
  else if (job.type === "subtitle") parts.push("SRT");
  return parts.join(" • ");
}

export function progressLabel(job: DownloadJob): string {
  if (job.state === "completed") return "100%";
  if (typeof job.progress === "number" && Number.isFinite(job.progress)) {
    if (job.state === "preparing" || job.state === "starting") {
      return `${Math.round(job.progress)}%`;
    }
    if (job.totalBytes && job.totalBytes > 0) {
      return `${Math.round(job.progress)}%`;
    }
  }
  return "";
}

export function etaLabel(job: DownloadJob): string {
  if (!isActiveDownloadState(job.state)) return "";
  if (job.state === "paused") return "";
  if (typeof job.etaSeconds === "number" && job.etaSeconds >= 0) {
    const formatted = formatETA(job.etaSeconds);
    if (formatted) return `~${formatted}`;
  }
  if (
    job.state === "preparing" ||
    job.state === "starting" ||
    job.state === "downloading"
  ) {
    return "Temps restant : Calcul…";
  }
  return "";
}

export function speedLabel(job: DownloadJob): string {
  if (!isActiveDownloadState(job.state)) return "";
  if (job.state === "paused") return "";
  const s = formatSpeed(job.speedBytesPerSecond);
  if (!s || s === "—") {
    if (job.state === "preparing" || job.state === "starting") {
      return "↓ …";
    }
    return "";
  }
  return `↓ ${s}`;
}
