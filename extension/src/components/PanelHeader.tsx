import { ArrowDownToLine, X } from "lucide-react";
import type { Locale } from "../i18n";
import { t } from "../i18n";

type Props = {
  locale: Locale;
  onClose: () => void;
};

export function PanelHeader({ locale, onClose }: Props) {
  return (
    <header className="nova-panel-header">
      <span className="nova-logo" aria-hidden>
        <ArrowDownToLine size={16} />
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
    </header>
  );
}
