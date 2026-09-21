import { isShortsPage, isWatchPage } from "../utils/videoId";
import { findYouTubePlayerContainer } from "../utils/youtubeSelectors";

export const HOST_ID = "novadownloader-host";
export const BUTTON_ATTR = "data-novadownloader-button";
export const OVERLAY_ID = "novadownloader-player-overlay";
export const FIXED_LAYER_ID = "novadownloader-fixed-layer";

const HOST_STYLE_ID = "novadownloader-host-style";

function ensureHostStyles() {
  let style = document.getElementById(HOST_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = HOST_STYLE_ID;
    document.documentElement.appendChild(style);
  }
  style.textContent = `
#${FIXED_LAYER_ID} {
  position: fixed !important;
  inset: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  pointer-events: none !important;
  z-index: 2147483645 !important;
  overflow: visible !important;
}
#${HOST_ID} {
  position: fixed !important;
  pointer-events: none !important;
  z-index: 2147483646 !important;
  font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
  overflow: visible !important;
}
/* Kill click-stealing on YouTube info / cards (i) */
.ytp-cards-button,
.ytp-cards-button *,
.ytp-cards-teaser,
.ytp-cards-teaser *,
.ytp-overflow-button,
.ytp-chrome-top .ytp-button[data-tooltip-target-id*="cards"],
.ytp-chrome-top-buttons .ytp-cards-button {
  pointer-events: none !important;
  visibility: hidden !important;
}
`;
}

export function findExistingHost(): HTMLElement | null {
  return document.getElementById(HOST_ID);
}

export function removeHost(): void {
  findExistingHost()?.remove();
  document.getElementById(OVERLAY_ID)?.remove();
  document.getElementById(FIXED_LAYER_ID)?.remove();
}

function ensureFixedLayer(): HTMLElement {
  let layer = document.getElementById(FIXED_LAYER_ID);
  if (!layer) {
    layer = document.createElement("div");
    layer.id = FIXED_LAYER_ID;
    layer.setAttribute("data-novadownloader-fixed-layer", "true");
    document.documentElement.appendChild(layer);
  } else if (layer.parentElement !== document.documentElement) {
    document.documentElement.appendChild(layer);
  }
  return layer;
}

/** Place host at top-left of the player (viewport coords). */
export function placeHostDefault(host: HTMLElement): void {
  if (host.dataset.dragged === "true") return;
  const player = findYouTubePlayerContainer();
  const r = player?.getBoundingClientRect();
  const pad = 16;
  if (r && r.width > 40 && r.height > 40) {
    host.style.left = `${Math.round(r.left + pad)}px`;
    host.style.top = `${Math.round(r.top + pad)}px`;
  } else {
    host.style.left = `${pad}px`;
    host.style.top = `${pad}px`;
  }
  host.style.right = "auto";
}

export function ensureHost(): { host: HTMLElement; isShorts: boolean } | null {
  ensureHostStyles();
  const shorts = isShortsPage();
  const watch = isWatchPage();
  if (!shorts && !watch) {
    removeHost();
    return null;
  }

  const player = findYouTubePlayerContainer();
  if (!player) {
    const existing = findExistingHost();
    return existing ? { host: existing, isShorts: shorts } : null;
  }

  // Remove legacy in-player overlay if present
  document.getElementById(OVERLAY_ID)?.remove();

  const layer = ensureFixedLayer();
  let host = findExistingHost();
  if (!host) {
    host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("data-novadownloader-host", "true");
    layer.appendChild(host);
  } else if (host.parentElement !== layer) {
    layer.appendChild(host);
  }

  host.dataset.shorts = shorts ? "true" : "false";
  placeHostDefault(host);
  return { host, isShorts: shorts };
}

/** Keep the button glued to the player when the page scrolls/resizes. */
export function startHostPositionSync(): () => void {
  const tick = () => {
    const host = findExistingHost();
    if (!host || host.dataset.dragged === "true") return;
    placeHostDefault(host);
  };
  tick();
  window.addEventListener("scroll", tick, true);
  window.addEventListener("resize", tick);
  const id = window.setInterval(tick, 500);
  return () => {
    window.removeEventListener("scroll", tick, true);
    window.removeEventListener("resize", tick);
    window.clearInterval(id);
  };
}
