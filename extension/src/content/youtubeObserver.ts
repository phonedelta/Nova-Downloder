import {
  getCurrentPageVideoId,
  isShortsPage,
  isSupportedYouTubePage,
  isWatchPage,
} from "../utils/videoId";
import { debugLog } from "../utils/debug";

type NavHandler = (videoId: string | null) => void;

let previousVideoId: string | null = null;
let started = false;

export function getPreviousVideoId() {
  return previousVideoId;
}

export function handleYouTubeNavigation(onChange: NavHandler): void {
  const current = isSupportedYouTubePage() ? getCurrentPageVideoId() : null;
  if (current === previousVideoId) return;
  debugLog("navigation", previousVideoId, "→", current);
  previousVideoId = current;
  onChange(current);
}

export function startYouTubeObserver(onChange: NavHandler): () => void {
  if (started) {
    handleYouTubeNavigation(onChange);
    return () => undefined;
  }
  started = true;
  previousVideoId = null;

  const notify = () => handleYouTubeNavigation(onChange);

  notify();

  const wrap = (method: "pushState" | "replaceState") => {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args as [unknown, string, string?]);
      window.dispatchEvent(new Event("nova:locationchange"));
      return result;
    };
  };
  wrap("pushState");
  wrap("replaceState");

  const onPop = () => window.dispatchEvent(new Event("nova:locationchange"));
  window.addEventListener("popstate", onPop);
  window.addEventListener("nova:locationchange", notify);

  const onYtNav = () => notify();
  document.addEventListener("yt-navigate-finish", onYtNav);
  document.addEventListener("yt-page-data-updated", onYtNav);

  let lastHref = location.href;
  let ensureTimer = 0;
  const scheduleEnsure = () => {
    window.clearTimeout(ensureTimer);
    ensureTimer = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("nova:ensure-button"));
    }, 250);
  };

  // Observe only body childList at a shallow+moderate depth via polling href
  // and a throttled observer on ytd-app when present.
  const observer = new MutationObserver(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      notify();
    }
    if (isSupportedYouTubePage() && getCurrentPageVideoId()) {
      scheduleEnsure();
    }
  });

  const attachTarget = () => {
    const target =
      document.querySelector("ytd-app") ||
      document.querySelector("#content") ||
      document.body;
    if (target) {
      observer.observe(target, { childList: true, subtree: true });
      return true;
    }
    return false;
  };

  if (!attachTarget()) {
    const boot = new MutationObserver(() => {
      if (attachTarget()) boot.disconnect();
    });
    boot.observe(document.documentElement, { childList: true, subtree: true });
  }

  // Fallback poll for URL (cheap) — YouTube sometimes skips history events
  const poll = window.setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      notify();
    }
  }, 1000);

  return () => {
    started = false;
    window.clearInterval(poll);
    window.clearTimeout(ensureTimer);
    window.removeEventListener("popstate", onPop);
    window.removeEventListener("nova:locationchange", notify);
    document.removeEventListener("yt-navigate-finish", onYtNav);
    document.removeEventListener("yt-page-data-updated", onYtNav);
    observer.disconnect();
  };
}

export { isWatchPage, isShortsPage, isSupportedYouTubePage };
