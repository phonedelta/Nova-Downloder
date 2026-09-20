/** Centralized YouTube DOM selectors — update here when YouTube changes. */

export const YT_SELECTORS = {
  player: [
    "#movie_player",
    ".html5-video-player",
    "ytd-player #container.ytd-player",
    "ytd-watch-flexy #player-container-inner",
    "#player-container-inner",
    "#player-container",
  ],
  shortsPlayer: [
    "ytd-reel-video-renderer[is-active] #player-container",
    "ytd-reel-video-renderer[is-active] .html5-video-player",
    "ytd-reel-video-renderer[is-active] #movie_player",
    "#shorts-player",
    "ytd-shorts #player-container",
  ],
  watchActions: [
    "ytd-watch-metadata #actions #actions-inner",
    "ytd-watch-metadata #actions-inner",
    "ytd-watch-metadata #top-level-buttons-computed",
    "ytd-watch-metadata #actions",
    "#actions #menu-container",
    "#menu-container #top-level-buttons-computed",
  ],
  shortsActions: [
    "ytd-reel-video-renderer[is-active] #actions",
    "ytd-shorts ytd-reel-video-renderer[is-active] #actions",
    "#shorts-player ~ * #actions",
    "ytd-reel-player-overlay-renderer #actions",
  ],
  darkTheme: ["html[dark]", "html[dark=true]", '[dark="true"]'],
  videoTitle: [
    "h1.ytd-watch-metadata yt-formatted-string",
    "ytd-watch-metadata h1",
    "h1.ytd-video-primary-info-renderer",
    "ytd-reel-player-header-renderer h2",
  ],
} as const;

function firstMatch(selectors: readonly string[]): HTMLElement | null {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el instanceof HTMLElement) return el;
  }
  return null;
}

/** Real YouTube media player container (watch + cinema + fullscreen source). */
export function findYouTubePlayerContainer(): HTMLElement | null {
  const path = location.pathname;
  if (path.startsWith("/shorts/")) {
    return firstMatch(YT_SELECTORS.shortsPlayer) || firstMatch(YT_SELECTORS.player);
  }
  return firstMatch(YT_SELECTORS.player);
}

export function findVideoActionContainer(): HTMLElement | null {
  return firstMatch(YT_SELECTORS.watchActions);
}

export function findShortsActionContainer(): HTMLElement | null {
  return firstMatch(YT_SELECTORS.shortsActions);
}

export function getPageVideoTitle(): string | null {
  const el = firstMatch(YT_SELECTORS.videoTitle);
  const text = el?.textContent?.trim();
  return text || null;
}

export function isYouTubeDarkTheme(): boolean {
  if (document.documentElement.hasAttribute("dark")) return true;
  if (document.querySelector("html[dark]")) return true;
  const color = getComputedStyle(document.documentElement)
    .getPropertyValue("--yt-spec-base-background")
    .trim();
  if (color) {
    const rgb = color.match(/\d+/g)?.map(Number);
    if (rgb && rgb.length >= 3) {
      const [r, g, b] = rgb;
      return (r * 299 + g * 587 + b * 114) / 1000 < 128;
    }
  }
  return (
    window.matchMedia("(prefers-color-scheme: dark)").matches &&
    !document.documentElement.hasAttribute("light")
  );
}
