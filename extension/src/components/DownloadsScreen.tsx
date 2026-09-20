import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { DownloadJob } from "@nova/shared";
import {
  isActiveDownloadState,
  isFailedDownloadState,
} from "@nova/shared";
import { DownloadCard } from "./DownloadCard";
import type { Locale } from "../i18n";
import { t } from "../i18n";

type Filter = "active" | "completed" | "failed";

type Props = {
  locale: Locale;
  downloads: DownloadJob[];
  onBack: () => void;
  onPause: (job: DownloadJob) => void;
  onResume: (job: DownloadJob) => void;
  onCancel: (job: DownloadJob) => void;
  onDismiss: (jobId: string) => void;
  onRetry: (job: DownloadJob) => void;
};

export function DownloadsScreen({
  locale,
  downloads,
  onBack,
  onPause,
  onResume,
  onCancel,
  onDismiss,
  onRetry,
}: Props) {
  const [filter, setFilter] = useState<Filter>("active");

  const { active, completed, failed } = useMemo(() => {
    return {
      active: downloads.filter((j) => isActiveDownloadState(j.state)),
      completed: downloads.filter((j) => j.state === "completed"),
      failed: downloads.filter((j) => isFailedDownloadState(j.state)),
    };
  }, [downloads]);

  const list =
    filter === "active"
      ? active
      : filter === "completed"
        ? completed
        : failed;

  const emptyLabel =
    filter === "active"
      ? t("Aucun téléchargement en cours.", locale)
      : filter === "completed"
        ? t("Aucun téléchargement terminé.", locale)
        : t("Aucun échec récent.", locale);

  return (
    <div className="nova-dl-screen">
      <div className="nova-dl-screen-header">
        <button
          type="button"
          className="nova-icon-btn"
          aria-label={t("Retour", locale)}
          onClick={onBack}
        >
          <ArrowLeft size={18} />
        </button>
        <h3>{t("Téléchargements", locale)}</h3>
      </div>

      <div className="nova-dl-filters" role="tablist">
        {(
          [
            [
              "active",
              `${t("En cours", locale)}${active.length ? ` ${active.length}` : ""}`,
            ],
            [
              "completed",
              `${t("Terminés", locale)}${completed.length ? ` ${completed.length}` : ""}`,
            ],
            [
              "failed",
              `${t("Échecs", locale)}${failed.length ? ` ${failed.length}` : ""}`,
            ],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            className="nova-dl-filter"
            aria-selected={filter === id}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="nova-dl-screen-list">
        {list.length === 0 ? (
          <p className="nova-hint">{emptyLabel}</p>
        ) : (
          list.map((job) => (
            <DownloadCard
              key={job.id}
              job={job}
              onPause={onPause}
              onResume={onResume}
              onCancel={onCancel}
              onDismiss={onDismiss}
              onRetry={onRetry}
            />
          ))
        )}
      </div>

      <p className="nova-dl-hint nova-dl-screen-hint">
        {t(
          "Vous pouvez fermer NovaDownloader — le téléchargement continue dans votre navigateur.",
          locale,
        )}
      </p>
    </div>
  );
}
