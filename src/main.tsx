import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import Home from "./pages/Home";
import {
  ExtensionDevInstallPage,
  ExtensionPage,
} from "./pages/Extension";
import "./styles.css";

function useShell() {
  const [path, setPath] = useState(window.location.pathname);
  const [lang, setLang] = useState("fr");
  const [light, setLight] = useState(
    () => localStorage.getItem("nova-theme") === "light",
  );

  useEffect(() => {
    const onNav = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onNav);
    return () => window.removeEventListener("popstate", onNav);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  useEffect(() => {
    document.documentElement.dataset.theme = light ? "light" : "dark";
    localStorage.setItem("nova-theme", light ? "light" : "dark");
  }, [light]);

  return {
    path,
    lang,
    setLang,
    light,
    toggle: () => setLight((v) => !v),
  };
}

function App() {
  const { path, lang, setLang, light, toggle } = useShell();
  const shared = { light, toggle, lang, setLang };

  if (path.startsWith("/extension/dev-install")) {
    return <ExtensionDevInstallPage {...shared} />;
  }
  if (path.startsWith("/extension")) {
    return <ExtensionPage {...shared} />;
  }
  return <Home />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
