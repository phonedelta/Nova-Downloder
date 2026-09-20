import { Download, Info, LoaderCircle } from "lucide-react";
import type { Locale } from "../i18n";
import { t } from "../i18n";

type Props = {
  locale: Locale;
  bitrate: string;
  onBitrateChange: (v: string) => void;
  busy: boolean;
  buttonText: string;
  onDownload: () => void;
};

const OPTIONS = [
  { value: "0", labelKey: "Meilleure qualité" },
  { value: "320", label: "320 kbps" },
  { value: "256", label: "256 kbps" },
  { value: "192", label: "192 kbps" },
  { value: "128", label: "128 kbps" },
] as const;

export function AudioTab({
  locale,
  bitrate,
  onBitrateChange,
  busy,
  buttonText,
  onDownload,
}: Props) {
  return (
    <div>
      <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>
        {t("Télécharger l’audio", locale)}
      </h3>
      <p className="nova-hint" style={{ marginTop: 0 }}>
        {t("Extrayez la piste audio complète de la vidéo.", locale)}
      </p>
      <div className="nova-field">
        <label htmlFor="nova-audio-quality">{t("Qualité", locale)}</label>
        <select
          id="nova-audio-quality"
          value={bitrate}
          onChange={(e) => onBitrateChange(e.target.value)}
        >
          {OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {"labelKey" in o ? t(o.labelKey, locale) : o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="nova-field">
        <label htmlFor="nova-audio-format">{t("Format", locale)}</label>
        <select id="nova-audio-format" disabled value="mp3">
          <option value="mp3">MP3</option>
        </select>
      </div>
      <div className="nova-hint">
        <Info size={12} aria-hidden />
        <span>
          {t(
            "La conversion n’améliore pas la qualité de la source.",
            locale,
          )}
        </span>
      </div>
      <button
        type="button"
        className="nova-action nova-action--full"
        disabled={busy}
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
