import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NovaButton } from "../components/NovaButton";
import { DownloadPanel } from "../components/DownloadPanel";
import { ensureHost, removeHost, HOST_ID, startHostPositionSync } from "./injectButton";
import {
  startYouTubeObserver,
  isShortsPage,
} from "./youtubeObserver";
import {
  buildWatchUrl,
  getCurrentPageVideoId,
} from "../utils/videoId";
import { getPageVideoTitle, isYouTubeDarkTheme } from "../utils/youtubeSelectors";
import { isVideoFullscreen } from "../utils/fullscreen";
import { detectLocale, t } from "../i18n";
import { browserApi } from "../utils/browserApi";
import type { ExtensionSettings } from "../types/api";
import { DEFAULT_SETTINGS } from "../types/api";
import cssText from "../styles/extension.css?inline";
import { applyButtonPos, loadButtonPos } from "./buttonPosition";
import { useDraggableNovaButton } from "./useDraggableNovaButton";

type MountState = {
  root: Root;
  shadow: ShadowRoot;
  host: HTMLElement;
};

let mount: MountState | null = null;
let currentVideoId: string | null = null;

/** Cleared only on full page reload (content script reinject). */
let buttonDismissedThisPage = false;

function resolveTheme(
  settings: ExtensionSettings,
): "light" | "dark" {
  if (settings.theme === "light") return "light";
  if (settings.theme === "dark") return "dark";
  return isYouTubeDarkTheme() ? "dark" : "light";
}

function setHostVisible(visible: boolean) {
  const host = document.getElementById(HOST_ID);
  if (!host) return;
  host.style.display = visible ? "" : "none";
}

function App({
  videoId,
  isShorts,
  settings,
}: {
  videoId: string;
  isShorts: boolean;
  settings: ExtensionSettings;
}) {
  const [open, setOpen] = useState(false);
  const [compact, setCompact] = useState(window.innerWidth < 900);
  const [theme, setTheme] = useState(() => resolveTheme(settings));
  const [activeDownloads, setActiveDownloads] = useState(0);
  const [fullscreen, setFullscreen] = useState(() => isVideoFullscreen());
  const [dismissed, setDismissed] = useState(() => buttonDismissedThisPage);
  const locale = useMemo(
    () => detectLocale(settings.language),
    [settings.language],
  );

  const showButton = !fullscreen && !dismissed;

  useEffect(() => {
    setHostVisible(showButton || open);
    if (fullscreen && open) setOpen(false);
  }, [showButton, open, fullscreen]);

  useEffect(() => {
    const syncFs = () => setFullscreen(isVideoFullscreen());
    document.addEventListener("fullscreenchange", syncFs);
    document.addEventListener("webkitfullscreenchange", syncFs as EventListener);
    window.addEventListener("resize", syncFs);
    const timer = window.setInterval(syncFs, 800);
    return () => {
      document.removeEventListener("fullscreenchange", syncFs);
      document.removeEventListener(
        "webkitfullscreenchange",
        syncFs as EventListener,
      );
      window.removeEventListener("resize", syncFs);
      window.clearInterval(timer);
    };
  }, []);

  // Keep badge updated in realtime even when panel is closed.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const res = (await browserApi.sendMessage({
          type: "GET_DOWNLOADS",
        })) as { type: string; activeCount?: number };
        if (
          !cancelled &&
          res.type === "DOWNLOADS" &&
          typeof res.activeCount === "number"
        ) {
          setActiveDownloads(res.activeCount);
        }
      } catch {
        /* */
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const onMessage = (message: { type?: string }) => {
      if (message?.type !== "DOWNLOAD_UPDATED") return;
      void refreshBadge();
    };
    const refreshBadge = async () => {
      try {
        const res = (await browserApi.sendMessage({
          type: "GET_DOWNLOADS",
        })) as { type: string; activeCount?: number };
        if (res.type === "DOWNLOADS" && typeof res.activeCount === "number") {
          setActiveDownloads(res.activeCount);
        }
      } catch {
        /* */
      }
    };
    const onStorage = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && changes.nova_dl_broadcast) void refreshBadge();
    };
    try {
      browserApi.runtime.onMessage.addListener(onMessage as never);
      browserApi.storage.onChanged.addListener(onStorage);
      return () => {
        browserApi.runtime.onMessage.removeListener(onMessage as never);
        browserApi.storage.onChanged.removeListener(onStorage);
      };
    } catch {
      return undefined;
    }
  }, []);

  useEffect(() => {
    const onResize = () => setCompact(window.innerWidth < 900);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const syncTheme = () => setTheme(resolveTheme(settings));
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["dark", "light", "class"],
    });
    return () => observer.disconnect();
  }, [settings]);

  useEffect(() => {
    const onOpen = () => {
      if (buttonDismissedThisPage || isVideoFullscreen()) return;
      setOpen(true);
    };
    window.addEventListener("nova:open-panel", onOpen);
    return () => window.removeEventListener("nova:open-panel", onOpen);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  const dismissButton = useCallback(() => {
    buttonDismissedThisPage = true;
    setDismissed(true);
    setOpen(false);
    setHostVisible(false);
  }, []);

  const toggleOpen = useCallback(() => setOpen((v) => !v), []);
  const dragHandlers = useDraggableNovaButton(toggleOpen);

  // Restore saved button position (away from YouTube’s overlapping “i”)
  useEffect(() => {
    let cancelled = false;
    void loadButtonPos().then((pos) => {
      if (cancelled || !pos) return;
      const host = document.getElementById(HOST_ID);
      if (host) applyButtonPos(host, pos);
    });
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  if (!showButton && !open) {
    return null;
  }

  return (
    <div
      className="nova-root"
      data-theme={theme}
      data-shorts={isShorts ? "true" : undefined}
      dir={locale === "ar" ? "rtl" : "ltr"}
    >
      {showButton ? (
        <NovaButton
          compact={compact || isShorts}
          open={open}
          labelFull={t("NovaDownloader", locale)}
          labelShort={t("Nova", locale)}
          activeCount={activeDownloads}
          onClick={toggleOpen}
          onDismiss={dismissButton}
          dragHandlers={dragHandlers}
          dragTitle={t(
            "Glisser pour déplacer · double-clic pour réinitialiser",
            locale,
          )}
        />
      ) : null}
      {open ? (
        <DownloadPanel
          videoId={videoId}
          videoUrl={buildWatchUrl(videoId)}
          pageTitle={getPageVideoTitle()}
          theme={theme}
          localeHint={settings.language}
          isShorts={isShorts}
          onClose={close}
          onActiveCountChange={setActiveDownloads}
        />
      ) : null}
    </div>
  );
}

async function loadSettings(): Promise<ExtensionSettings> {
  try {
    const res = await browserApi.sendMessage<{
      type: string;
      settings?: ExtensionSettings;
    }>({ type: "GET_SETTINGS" });
    if (res.type === "SETTINGS" && res.settings) return res.settings;
  } catch {
    /* ignore */
  }
  return DEFAULT_SETTINGS;
}

async function renderIntoHost(host: HTMLElement, videoId: string, isShorts: boolean) {
  const settings = await loadSettings();
  if (getCurrentPageVideoId() !== videoId) return;

  const savedPos = await loadButtonPos();
  if (savedPos) applyButtonPos(host, savedPos);

  if (!mount || mount.host !== host) {
    mount?.root.unmount();
    const shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
    shadow.innerHTML = "";
    const style = document.createElement("style");
    style.textContent = cssText;
    const mountEl = document.createElement("div");
    shadow.append(style, mountEl);
    mount = { root: createRoot(mountEl), shadow, host };
  }

  mount.root.render(
    <App videoId={videoId} isShorts={isShorts} settings={settings} />,
  );
}

async function syncUi(videoId: string | null) {
  currentVideoId = videoId;
  if (!videoId) {
    mount?.root.unmount();
    mount = null;
    removeHost();
    return;
  }

  const ensured = ensureHost();
  if (!ensured) return;
  await renderIntoHost(ensured.host, videoId, ensured.isShorts);
}

export function bootstrapYouTubeExtension() {
  const stopSync = startHostPositionSync();
  window.addEventListener("pagehide", () => stopSync(), { once: true });

  startYouTubeObserver((videoId) => {
    void syncUi(videoId);
  });

  window.addEventListener("nova:ensure-button", () => {
    if (!currentVideoId) currentVideoId = getCurrentPageVideoId();
    if (currentVideoId) void syncUi(currentVideoId);
  });

  browserApi.runtime.onMessage.addListener((message, _s, sendResponse) => {
    if (message?.type === "GET_CURRENT_VIDEO") {
      const videoId = getCurrentPageVideoId();
      sendResponse({
        type: "CURRENT_VIDEO",
        videoId,
        url: videoId ? buildWatchUrl(videoId) : null,
        title: getPageVideoTitle(),
        isYouTube: true,
      });
      return true;
    }
    if (message?.type === "OPEN_PANEL") {
      if (getCurrentPageVideoId()) {
        window.dispatchEvent(new Event("nova:open-panel"));
        // Ensure host exists
        void syncUi(getCurrentPageVideoId());
      }
      sendResponse({ type: "OK" });
      return true;
    }
    return undefined;
  });
}

// Keep isShortsPage referenced for tree-shaking clarity
void isShortsPage;
