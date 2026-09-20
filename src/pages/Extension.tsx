import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Puzzle,
  Download,
  MonitorPlay,
  Music2,
  Captions,
  Check,
  ArrowRight,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";
import { Brand } from "../components/Brand";
import { Navbar } from "../components/Navbar";
import { translate } from "../utils/i18n";
import {
  detectSupportedBrowser,
  installCtaLabel,
  isDesktopBrowser,
  storeUrlFor,
} from "../utils/browser";

function useExtensionInstalled() {
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    const check = () => {
      if (document.documentElement.dataset.novaExtension === "1") {
        setInstalled(true);
        return;
      }
      window.postMessage(
        { source: "nova-site", type: "NOVA_EXTENSION_PING" },
        "*",
      );
    };
    const onMessage = (event: MessageEvent) => {
      if (
        event.data?.source === "nova-extension" &&
        event.data?.type === "NOVA_EXTENSION_PONG"
      ) {
        setInstalled(true);
      }
    };
    window.addEventListener("message", onMessage);
    check();
    const timer = window.setInterval(check, 2500);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(timer);
    };
  }, []);
  return installed;
}

export function ExtensionPage({
  light,
  toggle,
  lang,
  setLang,
}: {
  light: boolean;
  toggle: () => void;
  lang: string;
  setLang: (s: string) => void;
}) {
  const t = (v: string) => translate(v, lang);
  const browser = detectSupportedBrowser();
  const desktop = isDesktopBrowser();
  const installed = useExtensionInstalled();
  const cta = installCtaLabel(browser, lang);
  const store = storeUrlFor(browser);

  return (
    <>
      <Navbar light={light} toggle={toggle} lang={lang} setLang={setLang} />
      <main className="extension-page">
        <section className="extension-hero">
          <div className="extension-copy">
            <span className="eyebrow">
              <Puzzle size={14} />
              {t("Extension navigateur")}
            </span>
            <h1>{t("NovaDownloader directement dans YouTube")}</h1>
            <p>
              {t(
                "Téléchargez vos vidéos, MP3 et sous-titres sans quitter YouTube.",
              )}
            </p>
            <div className="extension-badges">
              <span>
                <MonitorPlay size={13} />
                {t("Vidéo")}
              </span>
              <span>
                <Music2 size={13} />
                MP3
              </span>
              <span>
                <Captions size={13} />
                {t("Sous-titres")}
              </span>
              <span>4K</span>
            </div>

            {!desktop ? (
              <div className="extension-mobile-note">
                <ShieldCheck size={16} />
                <p>
                  {t(
                    "L’extension NovaDownloader est disponible sur les navigateurs desktop compatibles.",
                  )}
                </p>
              </div>
            ) : installed ? (
              <div className="extension-installed">
                <p>
                  <Check size={16} />
                  {t("Extension installée")}
                </p>
                <a
                  className="button green-button"
                  href="https://www.youtube.com"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("Ouvrir YouTube")}
                  <ArrowRight size={16} />
                </a>
              </div>
            ) : (
              <a
                className="button green-button extension-cta"
                href={store}
                target="_blank"
                rel="noreferrer"
              >
                <Puzzle size={18} />
                {cta}
                <ExternalLink size={15} />
              </a>
            )}
          </div>

          <motion.div
            className="extension-preview"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            aria-hidden
          >
            <div className="extension-player-mock">
              <div className="extension-player-top">
                <span className="extension-mock-btn">
                  <Download size={14} />
                  NovaDownloader
                </span>
              </div>
              <div className="extension-player-screen">
                <img src="/favicon.png" alt="" />
              </div>
            </div>
          </motion.div>
        </section>

        <section className="extension-steps">
          <h2>{t("Comment ça marche ?")}</h2>
          <ol>
            <li>{t("Installez l’extension")}</li>
            <li>{t("Ouvrez une vidéo YouTube")}</li>
            <li>{t("Cliquez sur NovaDownloader dans le lecteur")}</li>
            <li>{t("Choisissez Vidéo, MP3 ou Sous-titres")}</li>
            <li>{t("Le téléchargement démarre dans votre navigateur")}</li>
          </ol>
        </section>

        <section className="extension-dev">
          <h3>{t("Développeurs")}</h3>
          <p>
            {t(
              "Pour tester en local sans Chrome Web Store, utilisez le mode développeur.",
            )}
          </p>
          <a href="/extension/dev-install">{t("Guide d’installation locale")}</a>
        </section>
      </main>
      <footer>
        <div className="footer-top">
          <div>
            <Brand light={light} />
          </div>
          <div className="footer-links">
            <a href="/">{t("Accueil")}</a>
            <a href="/extension">{t("Extension navigateur")}</a>
          </div>
        </div>
      </footer>
    </>
  );
}

export function ExtensionDevInstallPage({
  light,
  toggle,
  lang,
  setLang,
}: {
  light: boolean;
  toggle: () => void;
  lang: string;
  setLang: (s: string) => void;
}) {
  const t = (v: string) => translate(v, lang);
  return (
    <>
      <Navbar light={light} toggle={toggle} lang={lang} setLang={setLang} />
      <main className="extension-page extension-dev-page">
        <h1>{t("Installation locale (développement)")}</h1>
        <p className="extension-dev-warning">
          {t(
            "Ce workflow est réservé au développement. Il ne remplace pas l’installation via le Chrome Web Store.",
          )}
        </p>
        <ol className="extension-dev-steps">
          <li>
            {t("Construire l’extension")} :{" "}
            <code>npm run build:extension</code>
          </li>
          <li>{t("Ouvrir")} <code>chrome://extensions</code></li>
          <li>{t("Activer le mode Développeur")}</li>
          <li>{t("Cliquer sur « Charger l’extension non empaquetée »")}</li>
          <li>
            {t("Sélectionner le dossier")} <code>dist-extension</code>
          </li>
        </ol>
        <a className="button" href="/extension">
          {t("Retour")}
        </a>
      </main>
    </>
  );
}
