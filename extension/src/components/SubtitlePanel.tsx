import { Download, LoaderCircle } from "lucide-react";
import type { Analysis } from "@nova/shared";
import type { Locale } from "../i18n";
import { t } from "../i18n";

type Props = {
  data: Analysis;
  locale: Locale;
  trackId: string;
  target: string;
  onTrackChange: (v: string) => void;
  onTargetChange: (v: string) => void;
  busy: boolean;
  buttonText: string;
  onDownload: () => void;
};

export function SubtitlePanel({
  data,
  locale,
  trackId,
  target,
  onTrackChange,
  onTargetChange,
  busy,
  buttonText,
  onDownload,
}: Props) {
  const hasTracks = data.subtitles.length > 0;
  return (
    <div className="nova-simple-panel">
      <div className="nova-field">
        <label htmlFor="nova-sub-lang">{t("Langue originale", locale)}</label>
        <select
          id="nova-sub-lang"
          value={trackId}
          disabled={!hasTracks}
          onChange={(e) => onTrackChange(e.target.value)}
        >
          {!hasTracks ? (
            <option value="">{t("Aucun sous-titre disponible", locale)}</option>
          ) : (
            data.subtitles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ·{" "}
                {s.automatic
                  ? t("Automatiques", locale)
                  : t("Officiels", locale)}
              </option>
            ))
          )}
        </select>
      </div>
      <div className="nova-field">
        <label htmlFor="nova-sub-target">{t("Traduire vers", locale)}</label>
        <select
          id="nova-sub-target"
          value={target}
          disabled={!hasTracks}
          onChange={(e) => onTargetChange(e.target.value)}
        >
          <option value="">
            {t("Version originale", locale) || "No translation — Original"}
          </option>
          {data.translationAvailable ? (
            <>
              <option value="en">English</option>
              <option value="fr">Français</option>
              <option value="ar">العربية</option>
              <option value="tr">Türkçe</option>
            </>
          ) : null}
        </select>
      </div>
      <div className="nova-field">
        <label htmlFor="nova-sub-format">{t("Format", locale)}</label>
        <select id="nova-sub-format" disabled value="srt">
          <option value="srt">SRT</option>
        </select>
      </div>
      <button
        type="button"
        className="nova-action nova-action--full"
        disabled={!hasTracks || busy}
        onClick={onDownload}
      >
        {busy ? (
          <LoaderCircle size={16} className="nova-spin" aria-hidden />
        ) : (
          <Download size={16} aria-hidden />
        )}
        {buttonText}
      </button>
    </div>
  );
}
