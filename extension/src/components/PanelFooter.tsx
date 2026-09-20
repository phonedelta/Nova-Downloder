import { ArrowDownToLine, ExternalLink } from "lucide-react";
import type { Locale } from "../i18n";
import { t } from "../i18n";

type Props = {
  locale: Locale;
  activeCount: number;
  siteUrl: string;
  onOpenDownloads: () => void;
};

export function PanelFooter({
  locale,
  activeCount,
  siteUrl,
  onOpenDownloads,
}: Props) {
  return (
    <footer className="nova-panel-footer">
      <button
        type="button"
        className="nova-footer-downloads"
        onClick={onOpenDownloads}
        aria-label={`Downloads ${activeCount}`}
      >
        <ArrowDownToLine size={15} aria-hidden />
        <span>
          Downloads{activeCount > 0 ? ` (${activeCount})` : ""}
        </span>
      </button>
      <a
        className="nova-external"
        href={siteUrl}
        target="_blank"
        rel="noreferrer"
      >
        {t("Plus d’options sur NovaDownloader", locale)}
        <ExternalLink size={11} aria-hidden />
      </a>
    </footer>
  );
}
