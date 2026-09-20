import { translate } from "../utils/i18n";
import { Globe, Sun, Moon, Menu, X, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Brand } from "./Brand";
export function Navbar({
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
  const t = (value: string) => translate(value, lang);
  const [open, setOpen] = useState(false);
  return (
    <header className="header">
      <div className="nav-wrap">
        <Brand light={light} />
        <nav
          className={open ? "nav open" : "nav"}
          aria-label={t("Navigation principale")}
        >
          {[
            [t("Accueil"), "/"],
            [t("Extension"), "/extension"],
            [t("Fonctionnalités"), "/#features"],
            [t("FAQ"), "/#faq"],
            [t("À propos"), "/#about"],
          ].map(([name, href], i) => (
            <a
              className={
                i === 0 && location.pathname === "/"
                  ? "active"
                  : href === "/extension" &&
                      location.pathname.startsWith("/extension")
                    ? "active"
                    : ""
              }
              key={name}
              href={href}
              onClick={(e) => {
                setOpen(false);
                if (href.startsWith("/") && !href.startsWith("/#")) {
                  e.preventDefault();
                  window.history.pushState({}, "", href);
                  window.dispatchEvent(new PopStateEvent("popstate"));
                }
              }}
            >
              {name}
            </a>
          ))}
        </nav>
        <div className="nav-actions">
          <button
            className="icon-button"
            onClick={toggle}
            aria-label={
              light ? t("Activer le thème sombre") : t("Activer le thème clair")
            }
          >
            {light ? <Moon size={19} /> : <Sun size={19} />}
          </button>
          <span className="nav-divider" />
          <label className="language">
            <Globe size={17} />
            <select
              aria-label={t("Langue de l’interface")}
              value={lang}
              onChange={(e) => setLang(e.target.value)}
            >
              <option value="fr">Français</option>
              <option value="en">English</option>
              <option value="ar">العربية</option>
              <option value="tr">Türkçe</option>
            </select>
            <ChevronDown size={13} />
          </label>
          <button
            className="icon-button mobile-menu"
            aria-label={t("Ouvrir le menu")}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
      </div>
    </header>
  );
}
