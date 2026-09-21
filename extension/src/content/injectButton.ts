import { isShortsPage, isWatchPage } from "../utils/videoId";
import { findYouTubePlayerContainer } from "../utils/youtubeSelectors";

export const HOST_ID = "novadownloader-host";
export const BUTTON_ATTR = "data-novadownloader-button";
export const OVERLAY_ID = "novadownloader-player-overlay";

const HOST_STYLE_ID = "novadownloader-host-style";

function ensureHostStyles() {
  let style = document.getElementById(HOST_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = HOST_STYLE_ID;
    document.documentElement.appendChild(style);
  }
  // Always refresh so updates apply after extension reload
  style.textContent = `
#${OVERLAY_ID} {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2147483000;
  overflow: visible;
}
#${HOST_ID} {
  position: absolute;
  /* Top-left — avoids YouTube’s cards / info (i) button on the top-right */
  top: 16px;
  left: 16px;
  right: auto;
  pointer-events: none;
  z-index: 2147483001;
  font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
  overflow: visible;
}
#${HOST_ID}[data-shorts="true"] {
  top: 12px;
  left: 12px;
  right: auto;
}
#${HOST_ID}[data-dragged="true"] {
  right: auto;
}
/* YouTube info / cards buttons must not steal clicks over Nova */
.ytp-cards-button,
.ytp-cards-teaser,
.ytp-overflow-button,
button.ytp-button[aria-label*="Info" i],
button.ytp-button[aria-label*="info" i],
button.ytp-button[data-tooltip-target-id*="cards"],
.ytp-chrome-top-buttons .ytp-button[aria-label*="Card" i] {
  pointer-events: none !important;
}
@media (max-width: 640px) {
  #${HOST_ID} {
    top: 10px;
    left: 10px;
  }
}
`;
}

export function findExistingHost(): HTMLElement | null {
  return document.getElementById(HOST_ID);
}

export function removeHost(): void {
  findExistingHost()?.remove();
  document.getElementById(OVERLAY_ID)?.remove();
}

function ensureOverlay(player: HTMLElement): HTMLElement {
  let overlay = document.getElementById(OVERLAY_ID) as HTMLElement | null;
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.setAttribute("data-novadownloader-overlay", "true");
  }
  const style = getComputedStyle(player);
  if (style.position === "static") {
    // Non-destructive: only set if static so absolute children work
    player.style.position = "relative";
  }
  if (overlay.parentElement !== player) {
    player.appendChild(overlay);
  }
  // Keep Nova above late-injected YouTube chrome
  player.appendChild(overlay);
  return overlay;
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

  const overlay = ensureOverlay(player);
  const existing = findExistingHost();
  if (existing) {
    if (existing.parentElement !== overlay) {
      overlay.appendChild(existing);
    }
    existing.dataset.shorts = shorts ? "true" : "false";
    return { host: existing, isShorts: shorts };
  }

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.setAttribute("data-novadownloader-host", "true");
  host.dataset.shorts = shorts ? "true" : "false";
  overlay.appendChild(host);
  return { host, isShorts: shorts };
}
