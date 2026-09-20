import { extractVideoId } from "@nova/shared";

export function getVideoIdFromUrl(url: string): string | null {
  return extractVideoId(url);
}

export function getCurrentPageVideoId(): string | null {
  return getVideoIdFromUrl(window.location.href);
}

export function isWatchPage(pathname = window.location.pathname): boolean {
  return pathname === "/watch";
}

export function isShortsPage(pathname = window.location.pathname): boolean {
  return pathname.startsWith("/shorts/");
}

export function isSupportedYouTubePage(
  pathname = window.location.pathname,
): boolean {
  return isWatchPage(pathname) || isShortsPage(pathname);
}

export function buildWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
