import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowDownToLine } from "lucide-react";
import { browserApi } from "../utils/browserApi";
import {
  DEFAULT_SETTINGS,
  type ExtensionSettings,
} from "../types/api";
import { detectLocale, isRtl, t } from "../i18n";
import cssText from "../styles/extension.css?inline";

function Options() {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const locale = detectLocale(settings.language);

  useEffect(() => {
    void (async () => {
      const res = await browserApi.sendMessage<{
        type: string;
        settings: ExtensionSettings;
      }>({ type: "GET_SETTINGS" });
      if (res.type === "SETTINGS") setSettings(res.settings);
    })();
  }, []);

  async function save() {
    const res = await browserApi.sendMessage<{
      type: string;
      settings: ExtensionSettings;
    }>({ type: "SAVE_SETTINGS", settings });
    if (res.type === "SETTINGS") {
      setSettings(res.settings);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    }
  }

  return (
    <div
      className="nova-root"
      data-theme={settings.theme === "dark" ? "dark" : "light"}
      dir={isRtl(locale) ? "rtl" : "ltr"}
      style={{
        maxWidth: 520,
        margin: "40px auto",
        padding: 24,
        background: settings.theme === "dark" ? "#23262f" : "#ffffff",
        borderRadius: 16,
        border: "1px solid #e4e6e1",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <span className="nova-logo">
          <ArrowDownToLine size={18} />
        </span>
        <h1 style={{ margin: 0, fontSize: 20 }}>{t("Paramètres", locale)}</h1>
      </div>

      <div className="nova-field">
        <label htmlFor="video-q">{t("Qualité vidéo préférée", locale)}</label>
        <select
          id="video-q"
          value={settings.preferredVideoQuality}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              preferredVideoQuality: e.target
                .value as ExtensionSettings["preferredVideoQuality"],
            }))
          }
        >
          <option value="best">{t("Meilleure disponible", locale)}</option>
          <option value="2160">2160p</option>
          <option value="1440">1440p</option>
          <option value="1080">1080p</option>
          <option value="720">720p</option>
        </select>
      </div>

      <div className="nova-field">
        <label htmlFor="audio-q">{t("Qualité audio préférée", locale)}</label>
        <select
          id="audio-q"
          value={settings.preferredAudioQuality}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              preferredAudioQuality: e.target
                .value as ExtensionSettings["preferredAudioQuality"],
            }))
          }
        >
          <option value="best">{t("Meilleure disponible", locale)}</option>
          <option value="320">320 kbps</option>
          <option value="256">256 kbps</option>
          <option value="192">192 kbps</option>
        </select>
      </div>

      <div className="nova-field">
        <label htmlFor="theme">{t("Thème", locale)}</label>
        <select
          id="theme"
          value={settings.theme}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              theme: e.target.value as ExtensionSettings["theme"],
            }))
          }
        >
          <option value="auto">{t("Auto", locale)}</option>
          <option value="light">{t("Clair", locale)}</option>
          <option value="dark">{t("Sombre", locale)}</option>
        </select>
      </div>

      <button type="button" className="nova-action nova-action--full" onClick={() => void save()}>
        {saved ? "✓" : t("Enregistrer", locale)}
      </button>

      <p className="nova-legal">
        {t(
          "Respectez les droits d’auteur et les conditions d’utilisation applicables.",
          locale,
        )}
      </p>
    </div>
  );
}

const style = document.createElement("style");
style.textContent = cssText;
document.head.append(style);
document.body.style.background = "#f7f8f3";
document.body.style.margin = "0";
document.body.style.fontFamily = "Segoe UI, system-ui, sans-serif";
createRoot(document.getElementById("root")!).render(<Options />);
