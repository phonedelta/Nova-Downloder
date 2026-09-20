/** Detect YouTube / browser video fullscreen (standard + webkit). */
export function isVideoFullscreen(): boolean {
  const doc = document as Document & {
    webkitFullscreenElement?: Element | null;
    webkitIsFullScreen?: boolean;
  };
  const fs =
    document.fullscreenElement ||
    doc.webkitFullscreenElement ||
    null;

  if (fs) {
    if (fs instanceof HTMLVideoElement) return true;
    if (fs.classList?.contains("html5-video-player")) return true;
    if (fs.id === "player-container" || fs.id === "player") return true;
    if (fs.querySelector?.("video.html5-main-video, video")) return true;
    if (fs.closest?.(".html5-video-player, ytd-player, #player")) return true;
    return true; // any page fullscreen while watching — hide our chrome
  }

  // YouTube sometimes toggles class without document fullscreen briefly
  if (document.querySelector(".html5-video-player.ytp-fullscreen")) return true;
  if (document.querySelector("ytd-app[fullscreen]")) return true;

  return Boolean(doc.webkitIsFullScreen);
}
