import { Download, LoaderCircle } from "lucide-react";
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
  { value: "0", labelKey: "Meilleure qualité" as const },
  { value: "320", label: "320 kbps" },
  { value: "256", label: "256 kbps" },
  { value: "192", label: "192 kbps" },
  { value: "128", label: "128 kbps" },
];

export function AudioPanel({
  locale,
  bitrate,
  onBitrateChange,
  busy,
  buttonText,
  onDownload,
}: Props) {
  return (
    <div className="nova-simple-panel">
      <div className="nova-field">
        <label htmlFor="nova-audio-quality">{t("Qualité audio", locale)}</label>
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
      {bitrate === "320" ? (
        <p className="nova-hint">
          Converted to 320 kbps from the best available source.
        </p>
      ) : (
        <p className="nova-hint">
          {t(
            "La conversion n’améliore pas la qualité de la source.",
            locale,
          )}
        </p>
      )}
      <div className="nova-field">
        <label htmlFor="nova-audio-format">{t("Format", locale)}</label>
        <select id="nova-audio-format" disabled value="mp3">
          <option value="mp3">MP3</option>
        </select>
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
