export type SupportedBrowser =
  | "chrome"
  | "edge"
  | "brave"
  | "firefox"
  | "safari"
  | "unknown";

export function detectSupportedBrowser(): SupportedBrowser {
  const ua = navigator.userAgent;
  const brands =
    (
      navigator as Navigator & {
        userAgentData?: { brands?: { brand: string }[] };
      }
    ).userAgentData?.brands?.map((b) => b.brand.toLowerCase()) || [];

  if (/firefox/i.test(ua)) return "firefox";
  if (/edg\//i.test(ua) || brands.some((b) => b.includes("microsoft edge")))
    return "edge";
  if (/brave/i.test(ua) || brands.some((b) => b.includes("brave")))
    return "brave";
  if (/chrome|crios/i.test(ua) && !/edg\//i.test(ua)) return "chrome";
  if (/safari/i.test(ua) && !/chrome|crios|android/i.test(ua)) return "safari";
  return "unknown";
}

export function isDesktopBrowser(): boolean {
  return !/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export const STORE_URLS = {
  chrome:
    import.meta.env.VITE_CHROME_WEB_STORE_URL ||
    "https://chromewebstore.google.com/detail/novadownloader",
  edge:
    import.meta.env.VITE_EDGE_ADDONS_URL ||
    import.meta.env.VITE_CHROME_WEB_STORE_URL ||
    "https://chromewebstore.google.com/detail/novadownloader",
  firefox:
    import.meta.env.VITE_FIREFOX_ADDONS_URL ||
    "https://addons.mozilla.org/firefox/addon/novadownloader/",
};

export function installCtaLabel(
  browser: SupportedBrowser,
  lang: string,
): string {
  const map: Record<string, Record<string, string>> = {
    fr: {
      chrome: "Ajouter à Chrome",
      edge: "Ajouter à Edge",
      brave: "Ajouter à Chrome",
      firefox: "Ajouter à Firefox",
      safari: "Voir les options d’installation",
      unknown: "Voir les options d’installation",
      install: "Installer NovaDownloader",
    },
    en: {
      chrome: "Add to Chrome",
      edge: "Add to Edge",
      brave: "Add to Chrome",
      firefox: "Add to Firefox",
      safari: "See install options",
      unknown: "See install options",
      install: "Install NovaDownloader",
    },
  };
  const t = map[lang] || map.fr;
  return t[browser] || t.unknown;
}

export function storeUrlFor(browser: SupportedBrowser): string {
  if (browser === "firefox") return STORE_URLS.firefox;
  if (browser === "edge") return STORE_URLS.edge;
  return STORE_URLS.chrome;
}
