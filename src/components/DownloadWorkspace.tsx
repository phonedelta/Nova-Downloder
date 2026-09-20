import { formatFileSize } from "../utils/fileSize";
import { translate } from "../utils/i18n";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Video,
  Music2,
  Captions,
  Info,
  Download,
  ChevronRight,
  Play,
  Clock,
  Eye,
  ArrowUpRight,
  Check,
  Link,
  ShieldCheck,
  FileVideo,
  Headphones,
  Languages,
  LoaderCircle,
} from "lucide-react";
import type { Analysis } from "../types";
import { duration } from "../utils/format";
import { useDownloads } from "../hooks/useDownloads";
type Props = {
  data: Analysis | null;
  loading: boolean;
  lang: string;
};
export function DownloadWorkspace({ data, loading, lang }: Props) {
  const t = (value: string) => translate(value, lang);
  const [tab, setTab] = useState("video"),
    [bitrate, setBitrate] = useState("0"),
    [track, setTrack] = useState(""),
    [target, setTarget] = useState("");
  const d = useDownloads();
  const selected = track || data?.subtitles[0]?.id || "";
  const visibleFormats = data
    ? Array.from(new Set(data.formats.map((f) => f.height)))
        .sort((a, b) => b - a)
        .map(
          (height) =>
            data.formats
              .filter((f) => f.height === height)
              .sort(
                (a, b) =>
                  Number(b.ext === "mp4") - Number(a.ext === "mp4") ||
                  Number(b.codec.startsWith("avc")) -
                    Number(a.codec.startsWith("avc")) ||
                  (b.fps || 0) - (a.fps || 0) ||
                  Number(!!(b.filesize || b.filesizeApprox)) - Number(!!(a.filesize || a.filesizeApprox)),
              )[0],
        )
    : [];
  const tabs = [
    { id: "video", title: t("Vidéo"), icon: Video },
    { id: "audio", title: "MP3", icon: Music2 },
    { id: "subtitles", title: t("Sous-titres"), icon: Captions },
    { id: "info", title: t("Informations"), icon: Info },
  ];
  const download = (kind: string, extra: object, label: string) => {
    if (data)
      void d.download(
        kind === "subtitles" ? "/subtitles" : `/download/${kind}`,
        { videoUrl: data.video.url, ...extra },
        {
          title: data.video.title,
          thumbnail: data.video.thumbnail,
          format: label,
        },
      );
  };
  const button = (
    kind: string,
    extra: object,
    label: string,
    text: string,
    cls = "",
  ) => (
    <button
      disabled={!data}
      className={`button ${cls}`}
      onClick={() => download(kind, extra, label)}
    >
      {d.busy ? (
        <LoaderCircle className="spin" size={16} />
      ) : (
        <Download size={16} />
      )}
      <span>
        {d.busy
          ? t(kind === "audio" ? "Préparation…" : "Préparation…")
          : text}
      </span>
    </button>
  );
  const audio = (
    <section className="inner-card audio-card">
      <div className="panel-heading">
        <span className="mini-icon green">
          <Music2 size={19} />
        </span>
        <h3>{t("Télécharger en MP3")}</h3>
        <span className="tag green-text">AUDIO</span>
      </div>
      <p>{t("Extrayez la piste audio complète de la vidéo.")}</p>
      <div className="fields">
        <label>
          {t("Qualité audio")}
          <select value={bitrate} onChange={(e) => setBitrate(e.target.value)}>
            <option value="0">{t("Meilleure qualité disponible")}</option>
            {["320", "256", "192", "128"].map((v) => (
              <option key={v} value={v}>
                {v} kbps
              </option>
            ))}
          </select>
        </label>
        <label className="format-field">
          {t("Format")}
          <select aria-label={t("Format audio")}>
            <option>MP3</option>
          </select>
        </label>
      </div>
      {button(
        "audio",
        { bitrate },
        "MP3",
        t("Télécharger MP3"),
        "green-button full",
      )}
      <small>
        <Info size={12} />
        {t("La conversion n’améliore pas la qualité de la source.")}
      </small>
    </section>
  );
  const subtitles = (
    <section className="inner-card subtitle-card">
      <div className="panel-heading">
        <span className="mini-icon purple">
          <Captions size={19} />
        </span>
        <h3>{t("Sous-titres")}</h3>
      </div>
      <p>{t("Téléchargez ou traduisez les sous-titres disponibles.")}</p>
      <div className="fields">
        <label>
          {t("Langue originale")}
          <select
            value={selected}
            disabled={!data?.subtitles.length}
            onChange={(e) => setTrack(e.target.value)}
          >
            {!data?.subtitles.length ? (
              <option>
                {data
                  ? t("Aucun sous-titre disponible")
                  : t("Détection automatique")}
              </option>
            ) : (
              data.subtitles.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.automatic ? t("Automatiques") : t("Officiels")}
                </option>
              ))
            )}
          </select>
        </label>
        <label>
          {t("Traduire vers")}
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={!data?.translationAvailable}
          >
            <option value="">{t("Version originale")}</option>
            <option value="fr">Français</option>
            <option value="en">English</option>
            <option value="ar">العربية</option>
            <option value="tr">Türkçe</option>
          </select>
        </label>
      </div>
      <label className="subtitle-format">
        {t("Format")}
        <select aria-label={t("Format")}>
          <option>.SRT</option>
        </select>
      </label>
      <div className="subtitle-bottom">
        <span className="file-badge">
          SRT <span>UTF-8</span>
        </span>
        <span>
          {t("Timecodes préservés")}
          <Check size={12} />
        </span>
      </div>
      <button
        className="button purple-button full"
        disabled={!selected}
        onClick={() =>
          download(
            "subtitles",
            { language: selected, targetLanguage: target },
            "SRT",
          )
        }
      >
        {d.busy ? (
          <LoaderCircle size={16} className="spin" />
        ) : (
          <Download size={16} />
        )}
        {d.busy ? t("Préparation…") : t("Télécharger le sous-titre")}
      </button>
      {data && !data.translationAvailable && (
        <small>{t("Traduction indisponible : service non configuré.")}</small>
      )}
    </section>
  );
  return (
    <>
      <motion.section
        className="workspace"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        aria-label={t("Options de téléchargement")}
      >
        {loading ? (
          <div
            className="preview skeleton-preview"
            aria-label={t("Analyse de la vidéo en cours")}
          >
            <div className="skeleton thumbnail" />
            <div className="skeleton-lines">
              <div className="skeleton" />
              <div className="skeleton" />
              <div className="skeleton" />
            </div>
          </div>
        ) : data ? (
          <div className="preview">
            <a
              className="thumbnail"
              href={data.video.url}
              target="_blank"
              rel="noreferrer"
            >
              <img src={data.video.thumbnail} alt={data.video.title} />
              <span className="play">
                <Play size={20} fill="currentColor" />
              </span>
              <span className="duration">{duration(data.video.duration)}</span>
            </a>
            <div className="video-heading">
              <span className="eyebrow">
                <span className="status-dot" />
                {t("VIDÉO ANALYSÉE")}
              </span>
              <h2>{data.video.title}</h2>
              <p>{data.video.channel}</p>
              <div className="video-meta">
                {data.video.views !== undefined && (
                  <span>
                    <Eye size={13} />
                    {new Intl.NumberFormat(lang, {
                      notation: "compact",
                    }).format(data.video.views)}{" "}
                    {t("vues")}
                  </span>
                )}
                <span>
                  <Clock size={13} />
                  {duration(data.video.duration)}
                </span>
              </div>
            </div>
            <a
              className="external-link"
              href={data.video.url}
              target="_blank"
              rel="noreferrer"
              aria-label={t("Voir sur YouTube")}
            >
              <ArrowUpRight size={20} />
            </a>
          </div>
        ) : (
          <div className="empty-preview">
            <div className="empty-art">
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
              <div className="art-media">
                <Play size={27} fill="currentColor" />
              </div>
              <span className="art-note">
                <Music2 size={15} />
              </span>
              <span className="art-cc">
                <Captions size={15} />
              </span>
            </div>
            <div>
              <span className="eyebrow">
                <span className="status-dot" />
                {t("TOUT COMMENCE PAR UN LIEN")}
              </span>
              <h2>{t("Vos contenus, à votre façon.")}</h2>
              <p>
                {t(
                  t(
                    "Ajoutez une vidéo pour découvrir tous ses formats disponibles.",
                  ),
                )}
              </p>
              <div className="empty-tags">
                <span>
                  <FileVideo size={12} />
                  {t("Vidéo")}
                </span>
                <span>
                  <Headphones size={12} />
                  {t("Audio")}
                </span>
                <span>
                  <Languages size={12} />
                  {t("Sous-titres")}
                </span>
              </div>
            </div>
            <span className="ready-badge">
              <span className="status-dot" />
              {t("Prêt à analyser")}
            </span>
          </div>
        )}
        <div className="tabs" role="tablist" aria-label={t("Type de contenu")}>
          {tabs.map(({ id, title, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              tabIndex={tab === id ? 0 : -1}
              onKeyDown={(e) => {
                const direction =
                  e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                if (direction) {
                  e.preventDefault();
                  const next =
                    tabs[
                      (tabs.findIndex((t) => t.id === id) +
                        direction +
                        tabs.length) %
                        tabs.length
                    ].id;
                  setTab(next);
                  document.getElementById(`tab-${next}`)?.focus();
                }
              }}
              aria-selected={tab === id}
              aria-controls="download-panel"
              id={`tab-${id}`}
              className={tab === id ? "tab active" : "tab"}
              onClick={() => setTab(id)}
            >
              <Icon size={17} />
              {title}
              {tab === id && <span className="tab-dot" />}
            </button>
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            id="download-panel"
            role="tabpanel"
            aria-labelledby={`tab-${tab}`}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="download-panel"
          >
            {tab === "video" ? (
              <>
                <section className="inner-card video-card">
                  <div className="panel-heading">
                    <span className="mini-icon blue">
                      <Download size={19} />
                    </span>
                    <h3>{t("Télécharger la vidéo")}</h3>
                    <span className="tag">VIDÉO</span>
                  </div>
                  <p>{t("Choisissez la qualité qui vous correspond.")}</p>
                  <div className="format-table">
                    <div className="table-head">
                      <span>{t("Qualité")}</span>
                      <span>{t("Format")}</span>
                      <span>FPS</span>
                      <span>{t("Taille")}</span>
                      <span className="action-heading">Action</span>
                    </div>
                    {loading ? (
                      Array.from({ length: 5 }, (_, i) => (
                        <div className="skeleton format-skeleton" key={i} />
                      ))
                    ) : data ? (
                      data.formats.length ? (
                        visibleFormats.map((f) => (
                          <div className="format-row" key={f.id}>
                            <strong>
                              {f.height}p{" "}
                              {f.height >= 2160 && (
                                <b className="quality-badge">
                                  {f.height >= 4320 ? "8K" : "4K"}
                                </b>
                              )}
                              <small>{f.hdr || f.codec.split(".")[0]}</small>
                            </strong>
                            <span className="format-container">
                              {f.ext === "mp4" ? "MP4" : "MKV"}
                            </span>
                            <span className="format-fps">
                              {f.fps ? `${f.fps} FPS` : "—"}
                            </span>
                            <span
                              className="file-size"
                              title={
                                f.sizeEstimated && f.displaySize
                                  ? t("Taille estimée")
                                  : undefined
                              }
                            >
                              {f.sizeEstimated && f.displaySize ? "~" : ""}
                              {t(formatFileSize(f.displaySize))}
                            </span>
                            {button(
                              "video",
                              { formatId: f.id },
                              `${f.height}p`,
                              t("Télécharger"),
                              "compact",
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="no-formats">
                          {t("Aucun format vidéo disponible.")}
                        </div>
                      )
                    ) : (
                      <div className="empty-formats">
                        <div className="empty-download-icon">
                          <Download size={25} />
                        </div>
                        <h4>{t("La bonne qualité. Le bon format.")}</h4>
                        <p>
                          {t("Les résolutions et les tailles réelles")}
                          <br />
                          {t("apparaîtront après l’analyse de votre vidéo.")}
                        </p>
                        <div className="resolution-chips">
                          <span>4K</span>
                          <span>1080p</span>
                          <span>720p</span>
                          <span>MP4</span>
                        </div>
                        <small>
                          {t("Selon les formats disponibles dans la source")}
                        </small>
                      </div>
                    )}
                  </div>
                  <div className="panel-footnote">
                    <ShieldCheck size={14} />
                    <span>{t("Vidéo et audio assemblés automatiquement")}</span>
                    <Check size={13} />
                  </div>
                </section>
              </>
            ) : tab === "audio" ? (
              audio
            ) : tab === "subtitles" ? (
              subtitles
            ) : (
              <section className="inner-card information">
                <div className="panel-heading">
                  <Info size={19} />
                  <h3>{t("Informations de la vidéo")}</h3>
                </div>
                {data ? (
                  <dl>
                    {Object.entries({
                      Titre: data.video.title,
                      Chaîne: data.video.channel,
                      Durée: duration(data.video.duration),
                      Vues: data.video.views?.toLocaleString(lang),
                      Publication: data.video.date?.replace(
                        /^(\d{4})(\d{2})(\d{2})$/,
                        "$3/$2/$1",
                      ),
                      [t("Résolution maximale")]: data.formats[0]
                        ? `${data.formats[0].height}p`
                        : undefined,
                      [t("FPS maximum")]:
                        Math.max(0, ...data.formats.map((f) => f.fps || 0)) ||
                        undefined,
                      Codecs: Array.from(
                        new Set(data.formats.map((f) => f.codec)),
                      ).join(", "),
                      [t("Formats audio")]: data.audioFormats.length,
                      [t("Sous-titres")]: data.subtitles.length,
                      Langues: Array.from(
                        new Set(data.subtitles.map((s) => s.language)),
                      ).join(", "),
                    })
                      .filter(([, v]) => v !== undefined && v !== "")
                      .map(([k, v]) => (
                        <div key={k}>
                          <dt>{t(k)}</dt>
                          <dd>{v}</dd>
                        </div>
                      ))}
                  </dl>
                ) : (
                  <div className="info-empty">
                    <Link size={28} />
                    <p>
                      {t(
                        "Analysez un lien pour afficher les informations de la vidéo.",
                      )}
                    </p>
                  </div>
                )}
              </section>
            )}
          </motion.div>
        </AnimatePresence>
        <div className="workspace-footer">
          <span>
            <ShieldCheck size={13} />
            {t("Aucun compte nécessaire")}
          </span>
          <span>
            {t("Un lien. Toutes les possibilités.")}
            <ChevronRight size={13} />
          </span>
        </div>
      </motion.section>
      {(d.status || d.error) && (
        <div className={`job-status ${d.error ? "error" : ""}`} role="status">
          {d.busy ? (
            <LoaderCircle size={18} className="spin" />
          ) : d.error ? (
            <Info size={18} />
          ) : (
            <Check size={18} />
          )}
          <span>{t(d.error || d.status)}</span>
        </div>
      )}
      {d.recent.length > 0 && (
        <section className="recent">
          <div className="section-title">
            <h3>{t("Téléchargements récents")}</h3>
            <button onClick={d.clear}>{t("Effacer l’historique")}</button>
          </div>
          {d.recent.map((r, i) => (
            <div className="recent-row" key={i}>
              <img src={r.thumbnail} alt="" loading="lazy" />
              <span>{r.title}</span>
              <b>{r.format}</b>
              <small>{new Date(r.date).toLocaleDateString(lang)}</small>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
