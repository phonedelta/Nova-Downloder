import { FolderOpen, MoreHorizontal, Pause, Play, RotateCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DownloadJob } from "@nova/shared";
import {
  formatETA,
  formatSpeed,
  isActiveDownloadState,
  isFailedDownloadState,
} from "@nova/shared";
import { browserApi } from "../utils/browserApi";
import { useSmoothNumber } from "../hooks/useSmoothNumber";
import {
  DownloadProgress,
  estimatedSizeHint,
  formatSizePair,
  jobMetaLine,
  jobStatusLabel,
  progressLabel,
} from "./DownloadProgress";

type Props = {
  job: DownloadJob;
  onPause: (job: DownloadJob) => void;
  onResume: (job: DownloadJob) => void;
  onCancel: (job: DownloadJob) => void;
  onDismiss: (jobId: string) => void;
  onRetry: (job: DownloadJob) => void;
};

export function DownloadCard({
  job,
  onPause,
  onResume,
  onCancel,
  onDismiss,
  onRetry,
}: Props) {
  const active = isActiveDownloadState(job.state);
  const failed = isFailedDownloadState(job.state);
  const completed = job.state === "completed";
  const pct = progressLabel(job);
  const sizeLine = formatSizePair(job);
  const estimateHint = estimatedSizeHint(job);

  const smoothSpeed = useSmoothNumber(
    active && job.state !== "paused" ? job.speedBytesPerSecond : null,
    { durationMs: 1100, decimals: 0 },
  );
  const smoothEta = useSmoothNumber(
    active && job.state !== "paused" ? job.etaSeconds : null,
    { durationMs: 1100, decimals: 0 },
  );

  const speed =
    smoothSpeed != null && smoothSpeed > 0
      ? `↓ ${formatSpeed(smoothSpeed)}`
      : active && job.state !== "paused"
        ? "↓ …"
        : "";
  const eta =
    smoothEta != null && smoothEta >= 0
      ? (() => {
          const formatted = formatETA(smoothEta);
          return formatted ? `~${formatted}` : "Temps restant : Calcul…";
        })()
      : active && job.state !== "paused"
        ? "Temps restant : Calcul…"
        : "";

  const indeterminate =
    (job.state === "preparing" || job.state === "starting") &&
    (job.progress == null || !Number.isFinite(job.progress))
      ? true
      : active &&
        job.state !== "preparing" &&
        (job.progress == null || !job.totalBytes || job.totalBytes <= 0);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc, true);
    return () => document.removeEventListener("mousedown", onDoc, true);
  }, [menuOpen]);

  const chromeId =
    typeof job.chromeDownloadId === "number" ? job.chromeDownloadId : null;
  const canPause =
    job.state === "preparing" ||
    job.state === "starting" ||
    job.state === "downloading";
  const canResume = job.state === "paused";

  return (
    <article className="nova-dl-card" data-state={job.state}>
      <div className="nova-dl-card-top">
        {job.thumbnail ? (
          <img className="nova-dl-thumb" src={job.thumbnail} alt="" />
        ) : (
          <div className="nova-dl-thumb nova-dl-thumb--empty" />
        )}
        <div className="nova-dl-card-main">
          <h4 className="nova-dl-title" title={job.title} dir="auto">
            {job.title}
          </h4>
          <p className="nova-dl-meta">{jobMetaLine(job)}</p>
        </div>
        {pct ? <span className="nova-dl-pct">{pct}</span> : null}
      </div>

      {!failed ? (
        <DownloadProgress
          progress={completed ? 100 : job.progress}
          indeterminate={indeterminate && !completed}
        />
      ) : null}

      {!failed ? (
        <div className="nova-dl-stats">
          <span>{sizeLine}</span>
          {speed ? <span>{speed}</span> : null}
          {eta && active ? <span>{eta}</span> : null}
        </div>
      ) : null}

      {estimateHint ? <p className="nova-dl-estimate">{estimateHint}</p> : null}

      <div className="nova-dl-card-footer">
        <span
          className={`nova-dl-status${failed ? " nova-dl-status--error" : ""}${completed ? " nova-dl-status--done" : ""}`}
        >
          {jobStatusLabel(job)}
        </span>
        <div className="nova-dl-actions" ref={menuRef}>
          {failed && job.videoUrl ? (
            <button
              type="button"
              className="nova-dl-retry"
              onClick={() => onRetry(job)}
            >
              <RotateCw size={12} />
              Réessayer
            </button>
          ) : null}

          {canPause ? (
            <button
              type="button"
              className="nova-dl-ctrl-btn"
              aria-label="Mettre en pause"
              title="Pause"
              onClick={() => onPause(job)}
            >
              <Pause size={12} />
              Pause
            </button>
          ) : null}

          {canResume ? (
            <button
              type="button"
              className="nova-dl-ctrl-btn"
              aria-label="Reprendre"
              title="Reprendre"
              onClick={() => onResume(job)}
            >
              <Play size={12} />
              Reprendre
            </button>
          ) : null}

          {active ? (
            <button
              type="button"
              className="nova-dl-ctrl-btn nova-dl-ctrl-btn--danger"
              aria-label="Annuler le téléchargement"
              title="Annuler"
              onClick={() => onCancel(job)}
            >
              <X size={12} />
              Annuler
            </button>
          ) : null}

          {completed && chromeId != null ? (
            <button
              type="button"
              className="nova-dl-icon-btn"
              aria-label="Ouvrir le fichier"
              onClick={() =>
                void browserApi.sendMessage({
                  type: "OPEN_DOWNLOAD",
                  chromeDownloadId: chromeId,
                })
              }
            >
              <FolderOpen size={14} />
            </button>
          ) : null}

          {completed && chromeId != null ? (
            <>
              <button
                type="button"
                className="nova-dl-icon-btn"
                aria-label="Plus d’actions"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
              >
                <MoreHorizontal size={14} />
              </button>
              {menuOpen ? (
                <div className="nova-dl-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      void browserApi.sendMessage({
                        type: "SHOW_DOWNLOAD",
                        chromeDownloadId: chromeId,
                      });
                    }}
                  >
                    <FolderOpen size={12} /> Afficher dans le dossier
                  </button>
                </div>
              ) : null}
            </>
          ) : null}

          {!active ? (
            <button
              type="button"
              className="nova-dl-icon-btn"
              aria-label="Masquer"
              onClick={() => onDismiss(job.id)}
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
