import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowDownToLine, Download, ExternalLink } from "lucide-react";
import { browserApi } from "../utils/browserApi";
import { NOVA_WEB_BASE_URL } from "../services/novaApi";
import { detectLocale, isRtl, t } from "../i18n";
import type { ExtensionResponse } from "../types/api";
import cssText from "../styles/extension.css?inline";

function Popup() {
  const locale = detectLocale();
  const [loading, setLoading] = useState(true);
  const [video, setVideo] = useState<{
    videoId: string | null;
    title: string | null;
    url: string | null;
  }>({ videoId: null, title: null, url: null });

  useEffect(() => {
    void (async () => {
      try {
        const tab = await browserApi.queryActiveTab();
        if (!tab?.id || !tab.url?.includes("youtube.com")) {
          setLoading(false);
          return;
        }
        const res = (await browserApi.sendTabMessage(
          tab.id,
          { type: "GET_CURRENT_VIDEO" },
        )) as ExtensionResponse;
        if (res.type === "CURRENT_VIDEO") {
          setVideo({
            videoId: res.videoId,
            title: res.title,
            url: res.url,
          });
        }
      } catch {
        /* content script may not be injected yet */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function openPanel() {
    const tab = await browserApi.queryActiveTab();
    if (!tab?.id) return;
    await browserApi.sendTabMessage(tab.id, { type: "OPEN_PANEL" });
    window.close();
  }

  return (
    <div
      className="nova-root"
      data-theme="light"
      dir={isRtl(locale) ? "rtl" : "ltr"}
      style={{
        width: 320,
        padding: 16,
        background: "#ffffff",
        color: "#23262f",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span className="nova-logo" aria-hidden>
          <ArrowDownToLine size={18} />
        </span>
        <strong style={{ fontSize: 15 }}>NovaDownloader</strong>
      </div>

      {loading ? (
        <p style={{ color: "#6b6f78", margin: 0 }}>…</p>
      ) : video.videoId ? (
        <>
          <p style={{ margin: "0 0 6px", fontSize: 12, color: "#6b6f78" }}>
            {t("Vidéo détectée", locale)}
          </p>
          <p
            style={{
              margin: "0 0 14px",
              fontWeight: 650,
              fontSize: 14,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {video.title || video.videoId}
          </p>
          <button type="button" className="nova-action nova-action--full" onClick={() => void openPanel()}>
            <Download size={16} aria-hidden />
            {t("Ouvrir les options de téléchargement", locale)}
          </button>
        </>
      ) : (
        <>
          <p style={{ margin: "0 0 14px", color: "#6b6f78", fontSize: 13 }}>
            {t("Ouvrez une vidéo YouTube pour utiliser NovaDownloader.", locale)}
          </p>
          <a
            className="nova-action nova-action--full"
            href={NOVA_WEB_BASE_URL}
            target="_blank"
            rel="noreferrer"
            style={{ textDecoration: "none" }}
          >
            <ExternalLink size={16} aria-hidden />
            {t("Ouvrir NovaDownloader", locale)}
          </a>
        </>
      )}

      <p className="nova-legal" style={{ marginTop: 14 }}>
        {t(
          "Respectez les droits d’auteur et les conditions d’utilisation applicables.",
          locale,
        )}
      </p>
      <a
        href={browserApi.runtime.getURL("options.html")}
        target="_blank"
        rel="noreferrer"
        style={{
          display: "inline-block",
          marginTop: 8,
          fontSize: 12,
          color: "#6b6f78",
        }}
      >
        {t("Paramètres", locale)}
      </a>
    </div>
  );
}

const style = document.createElement("style");
style.textContent = cssText;
document.head.append(style);
createRoot(document.getElementById("root")!).render(<Popup />);
