import { translate } from "../utils/i18n";
import { useState, useEffect } from "react";
import { motion, MotionConfig } from "framer-motion";
import {
  Link,
  Search,
  X,
  LoaderCircle,
  ShieldCheck,
  Zap,
  ArrowRight,
  Music2,
  Captions,
  Sparkles,
  ChevronDown,
  Check,
  MonitorPlay,
  Puzzle,
} from "lucide-react";
import { Navbar } from "../components/Navbar";
import { Brand } from "../components/Brand";
import { DownloadWorkspace } from "../components/DownloadWorkspace";
import { request } from "../services/api";
import { youtubeUrl } from "../utils/format";
import type { Analysis } from "../types";
const copy: Record<
  string,
  {
    title: string;
    gradient: string;
    subtitle: string;
    placeholder: string;
    analyze: string;
  }
> = {
  fr: {
    title: "Téléchargez vos contenus YouTube",
    gradient: "simplement et rapidement.",
    subtitle:
      "Vidéos, musiques, sous-titres et traductions.\nTout ce dont vous avez besoin, au même endroit.",
    placeholder: "Collez le lien YouTube ici…",
    analyze: "Analyser",
  },
  en: {
    title: "Download your YouTube content",
    gradient: "simply and quickly.",
    subtitle:
      "Videos, music, subtitles and translations.\nEverything you need, all in one place.",
    placeholder: "Paste your YouTube link here…",
    analyze: "Analyze",
  },
  ar: {
    title: "حمّل محتوى YouTube الخاص بك",
    gradient: "بسهولة وسرعة.",
    subtitle: "فيديوهات وموسيقى وترجمات.\nكل ما تحتاج إليه في مكان واحد.",
    placeholder: "الصق رابط YouTube هنا…",
    analyze: "تحليل",
  },
  tr: {
    title: "YouTube içeriklerinizi indirin",
    gradient: "kolayca ve hızlıca.",
    subtitle:
      "Videolar, müzik, altyazılar ve çeviriler.\nİhtiyacınız olan her şey tek bir yerde.",
    placeholder: "YouTube bağlantısını buraya yapıştırın…",
    analyze: "Analiz et",
  },
};
export default function Home() {
  const [url, setUrl] = useState(""),
    [loading, setLoading] = useState(false),
    [data, setData] = useState<Analysis | null>(null),
    [error, setError] = useState(""),
    [lang, setLang] = useState("fr"),
    [light, setLight] = useState(
      () => localStorage.getItem("nova-theme") === "light",
    ),
    [modal, setModal] = useState("");
  const t = (value: string) => translate(value, lang);
  const c = copy[lang];
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);
  useEffect(() => {
    document.documentElement.dataset.theme = light ? "light" : "dark";
    localStorage.setItem("nova-theme", light ? "light" : "dark");
  }, [light]);
  async function analyze(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!youtubeUrl(url)) {
      setError(t("Le lien renseigné n’est pas une URL YouTube valide."));
      return;
    }
    setLoading(true);
    setData(null);
    try {
      setData(await request<Analysis>("/analyze", { url }));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("Impossible d’analyser cette vidéo pour le moment."),
      );
    } finally {
      setLoading(false);
    }
  }
  return (
    <MotionConfig reducedMotion="user">
      <Navbar
        light={light}
        toggle={() => setLight(!light)}
        lang={lang}
        setLang={setLang}
      />
      <main>
        <motion.section
          className="hero"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="hero-badge">
            <Sparkles size={13} />
            <span>{t("VOS CONTENUS. SANS COMPLICATION.")}</span>
          </div>
          <div dir={lang === "ar" ? "rtl" : "ltr"}>
            <h1>
              {c.title}
              <br />
              <span>{c.gradient}</span>
            </h1>
            <p className="hero-description">{c.subtitle}</p>
          </div>
          <form className="analyzer" onSubmit={analyze}>
            <div className={`url-input ${error ? "invalid" : ""}`}>
              <Link size={20} />
              <label className="sr-only" htmlFor="youtube-url">
                {t("Lien YouTube")}
              </label>
              <input
                id="youtube-url"
                type="text"
                inputMode="url"
                autoComplete="off"
                placeholder={c.placeholder}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                aria-invalid={!!error}
                aria-describedby={error ? "url-error" : undefined}
              />
              {url && (
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => {
                    setUrl("");
                    setError("");
                  }}
                  aria-label={t("Vider le lien")}
                >
                  <X size={18} />
                </button>
              )}
            </div>
            <button className="button analyze-button" disabled={loading}>
              {loading ? (
                <LoaderCircle size={19} className="spin" />
              ) : (
                <Search size={19} />
              )}
              <span>{loading ? t("Analyse en cours…") : c.analyze}</span>
              {!loading && <ArrowRight size={17} />}
            </button>
          </form>
          {error && (
            <p id="url-error" role="alert" className="analyze-error">
              {error}
            </p>
          )}
          <div className="input-caption">
            <span>{t("Compatible avec")}</span>
            <span className="youtube-word">
              <MonitorPlay size={14} /> YouTube
            </span>
            <span className="caption-dot">·</span>
            <span>{t("Vidéos, Shorts et replays")}</span>
          </div>
          <div className="trust-row">
            <span>
              <Check size={13} />
              {t("Sans inscription")}
            </span>
            <span>
              <ShieldCheck size={13} />
              {t("Simple et sécurisé")}
            </span>
            <span>
              <Zap size={13} />
              {t("Toutes les qualités disponibles")}
            </span>
          </div>
          <a
            className="button extension-home-cta"
            href="/extension"
            onClick={(e) => {
              e.preventDefault();
              window.history.pushState({}, "", "/extension");
              window.dispatchEvent(new PopStateEvent("popstate"));
            }}
          >
            <Puzzle size={18} />
            {t("Ajouter l’extension")}
            <ArrowRight size={16} />
          </a>
        </motion.section>
        <div className="main-content">
          <div className="workspace-label">
            <span>{t("VOTRE ESPACE DE TÉLÉCHARGEMENT")}</span>
            <span>
              <span className="status-dot" />
              {t("Vidéo · Audio · Sous-titres")}
            </span>
          </div>
          <DownloadWorkspace
            lang={lang}
            key={data?.video.id || "empty"}
            data={data}
            loading={loading}
          />
          <section className="features" id="features">
            {[
              {
                icon: <span className="four-k">4K</span>,
                color: "green",
                title: t("Toutes les qualités"),
                text: t(
                  t(
                    "Du format léger à la très haute définition. Choisissez ce qui vous convient.",
                  ),
                ),
                tag: t("La qualité, au choix"),
              },
              {
                icon: <Music2 size={23} />,
                color: "pink",
                title: t("Votre audio, intact"),
                text: t(
                  t(
                    "Voix, musique et ambiance. Retrouvez toute la piste audio en MP3.",
                  ),
                ),
                tag: t("Chaque détail compte"),
              },
              {
                icon: <Captions size={23} />,
                color: "purple",
                title: t("Au-delà des langues"),
                text: t(
                  t(
                    "Sous-titres et traduction en français, anglais, arabe et turc.",
                  ),
                ),
                tag: t("Un contenu, sans frontières"),
              },
              {
                icon: <Zap size={23} />,
                color: "blue",
                title: t("Simple. Et rapide."),
                text: t(
                  t(
                    "Un lien, quelques clics. Une expérience fluide, sans compte à créer.",
                  ),
                ),
                tag: t("Allez à l’essentiel"),
              },
            ].map((f) => (
              <article className="feature-card" key={f.title}>
                <div className={`feature-icon ${f.color}`}>{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
                <span>
                  {f.tag}
                  <ArrowUpRightIcon />
                </span>
              </article>
            ))}
          </section>
          <section className="faq-section" id="faq">
            <div>
              <span className="eyebrow">{t("QUELQUES RÉPONSES")}</span>
              <h2>{t("Simple, du début à la fin.")}</h2>
              <p>{t("Tout ce qu’il faut savoir avant de commencer.")}</p>
            </div>
            <div className="faq-list">
              {[
                [
                  t("Comment télécharger une vidéo ?"),
                  t(
                    t(
                      "Collez un lien YouTube, cliquez sur Analyser, puis choisissez un format disponible. Le serveur prépare le fichier et assemble automatiquement la vidéo et le son lorsque nécessaire.",
                    ),
                  ),
                ],
                [
                  t("Quelles qualités sont disponibles ?"),
                  t(
                    t(
                      "Seules les résolutions et les pistes réellement présentes dans la vidéo sont proposées. Les tailles inconnues sont signalées ; une estimation de flux vidéo séparé exclut la piste audio.",
                    ),
                  ),
                ],
                [
                  t("Mes téléchargements sont-ils conservés ?"),
                  t(
                    t(
                      "Les fichiers temporaires sont supprimés après leur transfert ou après expiration. Un historique des titres et formats reste uniquement dans votre navigateur et peut être effacé.",
                    ),
                  ),
                ],
                [
                  t("La conversion MP3 améliore-t-elle le son ?"),
                  t(
                    t(
                      "Non. Le MP3 conserve la piste audio complète, mais convertir une source compressée en 320 kbps ne peut pas améliorer sa qualité originale.",
                    ),
                  ),
                ],
              ].map(([q, a]) => (
                <details key={q}>
                  <summary>
                    {q}
                    <ChevronDown size={16} />
                  </summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </section>
        </div>
      </main>
      <footer id="about">
        <div className="footer-top">
          <div>
            <Brand light={light} />
            <p>
              {t("Votre solution simple pour gérer")}
              <br />
              {t("vos téléchargements multimédias.")}
            </p>
          </div>
          <div className="footer-links">
            <a href="/">{t("Accueil")}</a>
            <a
              href="/extension"
              onClick={(e) => {
                e.preventDefault();
                window.history.pushState({}, "", "/extension");
                window.dispatchEvent(new PopStateEvent("popstate"));
              }}
            >
              {t("Extension navigateur")}
            </a>
            <a href="#faq">{t("FAQ")}</a>
            <button onClick={() => setModal(t("Confidentialité"))}>
              {t("Confidentialité")}
            </button>
            <button onClick={() => setModal(t("Conditions d’utilisation"))}>
              {t("Conditions d’utilisation")}
            </button>
            <button onClick={() => setModal(t("Nous contacter"))}>
              {t("Nous contacter")}
            </button>
          </div>
        </div>
        <div className="footer-bottom">
          <span>{t("© 2026 NovaDownloader. Tous droits réservés.")}</span>
          <span>
            {t("Conçu pour vous simplifier la vie.")}
            <span className="footer-spark"> ✦</span>
          </span>
        </div>
        <p className="legal-note">
          {t(
            "NovaDownloader n’est pas affilié à YouTube. Téléchargez uniquement les contenus pour lesquels vous disposez des droits ou autorisations nécessaires, dans le respect des droits d’auteur et des conditions des plateformes.",
          )}
        </p>
      </footer>
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal("")}>
          <dialog
            open
            className="modal"
            aria-label={modal}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setModal("");
            }}
          >
            <button
              autoFocus
              className="icon-button modal-close"
              aria-label={t("Fermer")}
              onClick={() => setModal("")}
            >
              <X />
            </button>
            <h2>{modal}</h2>
            <p>
              {modal === t("Confidentialité")
                ? t(
                    "Aucun compte n’est requis. L’historique des téléchargements est enregistré uniquement dans votre navigateur. Le serveur conserve temporairement les fichiers nécessaires à leur préparation, puis les supprime après le transfert ou à expiration. Les erreurs techniques sont journalisées pour le diagnostic.",
                  )
                : modal === t("Nous contacter")
                  ? t(
                      "Les coordonnées de contact de l’exploitant seront ajoutées lors de la mise en ligne du service.",
                    )
                  : t(
                      "Vous devez disposer des droits ou autorisations nécessaires pour télécharger un contenu et respecter les conditions des plateformes concernées. Le service ne contourne pas les restrictions d’accès. Les vidéos sont limitées à deux heures et les fichiers à 4 Go.",
                    )}
            </p>
            <button className="button" onClick={() => setModal("")}>
              {t("Compris")}
            </button>
          </dialog>
        </div>
      )}
    </MotionConfig>
  );
}
function ArrowUpRightIcon() {
  return <ArrowRight size={12} />;
}
