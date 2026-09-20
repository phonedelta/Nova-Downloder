import {
  analyzeIframeEmbed,
  analyzeVideoElement,
  isLikelyVideoIframe,
  isYouTubeHost,
  type DetectedWebVideo,
} from "./webVideoDetector";
import {
  findUnprocessedVideos,
  registerVideo,
  unregisterByVideo,
  refreshInfo,
} from "./videoPlayerRegistry";
import { createPlayerOverlay } from "./genericVideoButton";
import { openGenericPanel, closeGenericPanel } from "./genericVideoPanel";
import { collectSniffedMedia, startMediaSniffer } from "./mediaSniffer";
import { browserApi } from "../../utils/browserApi";

const IFRAME_ATTR = "data-nova-downloader-iframe";
const seenIframes = new WeakSet<HTMLIFrameElement>();
const iframeDisposers = new WeakMap<HTMLIFrameElement, () => void>();

function pushSniffedToBackground(): void {
  const urls = collectSniffedMedia().map((m) => m.url);
  if (!urls.length) return;
  void browserApi
    .sendMessage({
      type: "REGISTER_GENERIC_MEDIA",
      payload: { urls, pageUrl: location.href },
    })
    .catch(() => {
      /* SW may be waking */
    });
}

/**
 * Generic web-video integration (non-YouTube).
 * Must NEVER run on YouTube — YouTube uses the dedicated content script.
 *
 * Runs in all frames (manifest all_frames) so embed hosts get a button too.
 * On parent pages, also overlays iframe players (cross-origin video hosts).
 */
export function bootstrapGenericWebVideos(): void {
  if (isYouTubeHost()) {
    console.warn("[Nova generic] refused on YouTube host");
    return;
  }

  startMediaSniffer(() => {
    pushSniffedToBackground();
  });
  pushSniffedToBackground();

  const detachIframe = (iframe: HTMLIFrameElement) => {
    iframeDisposers.get(iframe)?.();
    iframeDisposers.delete(iframe);
    iframe.removeAttribute(IFRAME_ATTR);
    seenIframes.delete(iframe);
  };

  const attachVideo = (video: HTMLVideoElement) => {
    const { wrap, btn, dispose } = createPlayerOverlay(video);
    const entry = registerVideo(video, wrap);
    if (!entry) {
      dispose?.();
      return;
    }

    const open = () => {
      const info = refreshInfo(entry.id) || entry.info;
      // Re-analyze after playback may have set currentSrc
      const fresh = analyzeVideoElement(video);
      openGenericPanel(fresh.sources.length ? fresh : info, btn);
    };

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      open();
    });

    // Sources often appear only after play / HLS attach
    video.addEventListener("loadedmetadata", () => {
      refreshInfo(entry.id);
    });
  };

  const attachIframe = (iframe: HTMLIFrameElement) => {
    if (seenIframes.has(iframe)) return;
    if (iframe.getAttribute(IFRAME_ATTR) === "true") return;
    if (!isLikelyVideoIframe(iframe)) return;
    seenIframes.add(iframe);
    iframe.setAttribute(IFRAME_ATTR, "true");

    const { wrap, btn, dispose } = createPlayerOverlay(iframe);
    const getInfo = (): DetectedWebVideo => analyzeIframeEmbed(iframe);

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openGenericPanel(getInfo(), btn);
    });

    const cleanup = () => {
      dispose?.();
      wrap.remove();
      iframeDisposers.delete(iframe);
    };
    iframeDisposers.set(iframe, cleanup);

    // Clean UI if iframe removed
    const mo = new MutationObserver(() => {
      if (!document.contains(iframe)) {
        cleanup();
        mo.disconnect();
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  };

  const scan = (root: ParentNode = document) => {
    for (const video of findUnprocessedVideos(root)) {
      const rect = video.getBoundingClientRect();
      // Skip only clearly tiny decorative videos; allow 0×0 (not laid out yet)
      if (rect.width > 0 && rect.width < 64 && rect.height > 0 && rect.height < 64) {
        continue;
      }
      try {
        attachVideo(video);
      } catch (e) {
        console.warn("[Nova generic] video attach failed", e);
      }
    }

    const iframes = Array.from(
      root.querySelectorAll?.("iframe") || [],
    ) as HTMLIFrameElement[];
    // Also if root itself is iframe
    if (root instanceof HTMLIFrameElement) iframes.push(root);
    for (const iframe of iframes) {
      try {
        attachIframe(iframe);
      } catch (e) {
        console.warn("[Nova generic] iframe attach failed", e);
      }
    }
  };

  scan();
  // Late-loading players (SPA / server switchers)
  window.setTimeout(() => scan(), 1500);
  window.setTimeout(() => scan(), 4000);

  const observer = new MutationObserver((mutations) => {
    let needScan = false;
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (node.tagName === "VIDEO") attachVideo(node as HTMLVideoElement);
        else if (node.tagName === "IFRAME")
          attachIframe(node as HTMLIFrameElement);
        else needScan = true;
      });
      m.removedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (node.tagName === "VIDEO") {
          unregisterByVideo(node as HTMLVideoElement);
        } else {
          node.querySelectorAll?.("video").forEach((v) => {
            unregisterByVideo(v);
          });
        }
      });
      // Server switchers often only change iframe src
      if (
        m.type === "attributes" &&
        m.target instanceof HTMLIFrameElement &&
        (m.attributeName === "src" ||
          m.attributeName === "data-src" ||
          m.attributeName === "data-url")
      ) {
        const iframe = m.target;
        detachIframe(iframe);
        attachIframe(iframe);
      }
    }
    if (needScan) scan();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "data-src", "data-url"],
  });

  window.addEventListener("pagehide", () => {
    closeGenericPanel();
  });
}
