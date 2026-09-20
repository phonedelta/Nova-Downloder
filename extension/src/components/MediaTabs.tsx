import type { Locale } from "../i18n";
import { t } from "../i18n";
import type { PanelTab } from "../types/api";

type Props = {
  locale: Locale;
  active: PanelTab;
  onChange: (tab: PanelTab) => void;
};

const TABS: { id: PanelTab; label: (locale: Locale) => string }[] = [
  { id: "video", label: (l) => t("Vidéo", l) },
  { id: "audio", label: () => "MP3" },
  { id: "subtitles", label: (l) => t("Sous-titres", l) },
];

export function MediaTabs({ locale, active, onChange }: Props) {
  return (
    <div className="nova-segment" role="tablist" aria-label="Type de contenu">
      {TABS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          role="tab"
          className="nova-segment-btn"
          aria-selected={active === id}
          onClick={() => onChange(id)}
        >
          {label(locale)}
        </button>
      ))}
    </div>
  );
}
