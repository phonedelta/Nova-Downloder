import { isShortsPage, isWatchPage } from "../utils/videoId";
import { findYouTubePlayerContainer } from "../utils/youtubeSelectors";

export const HOST_ID = "novadownloader-host";
export const BUTTON_ATTR = "data-novadownloader-button";
export const OVERLAY_ID = "novadownloader-player-overlay";

const HOST_STYLE_ID = "novadownloader-host-style";

function ensureHostStyles() {
  if (document.getElementById(HOST_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = HOST_STYLE_ID;
  style.textContent = `
#${OVERLAY_ID} {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 45;
  overflow: visible;
}
#${HOST_ID} {
  position: absolute;
  top: 16px;
  right: 16px;
  left: auto;
  pointer-events: none;
  z-index: 46;
  font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
  overflow: visible;
}
#${HOST_ID}[data-shorts="true"] {
  top: 12px;
  right: 12px;
  left: auto;
}
#${HOST_ID}:fullscreen,
#${OVERLAY_ID}:fullscreen {
  /* host stays inside fullscreened player */
}
@media (max-width: 640px) {
  #${HOST_ID} {
    top: 10px;
    right: 10px;
  }
}
`;
  document.documentElement.appendChild(style);
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
