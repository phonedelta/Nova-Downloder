export type DetectedMediaSource = {
  url: string;
  mime?: string;
  label?: string;
  height?: number | null;
  width?: number | null;
};

export type DetectedWebVideo = {
  video: HTMLVideoElement | null;
  sources: DetectedMediaSource[];
  title: string;
  pageUrl: string;
  protected: boolean;
  unsupportedReason?: string;
  /** Embed page URL (iframe) — download via yt-dlp. */
  preferYtDlp?: boolean;
};

const MEDIA_EXT = /\.(mp4|webm|ogg|ogv|m4v|mov|mkv|mp3|m4a|aac|wav)(\?|#|$)/i;

function isHttpMediaUrl(url: string): boolean {
  try {
    const u = new URL(url, location.href);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.protocol === "blob:" || u.protocol === "data:") return false;
    return true;
  } catch {
    return false;
  }
}

function guessHeightFromLabel(label: string): number | null {
  const m = label.match(/\b(2160|1440|1080|720|480|360|240|144)p?\b/i);
  return m ? Number(m[1]) : null;
}

function guessHeightFromUrl(url: string): number | null {
  return guessHeightFromLabel(url);
}

function collectSources(video: HTMLVideoElement): DetectedMediaSource[] {
  const seen = new Set<string>();
  const out: DetectedMediaSource[] = [];

  const push = (raw: string, mime?: string, label?: string) => {
    if (!raw || !isHttpMediaUrl(raw)) return;
    let absolute: string;
    try {
      absolute = new URL(raw, location.href).toString();
    } catch {
      return;
    }
    if (seen.has(absolute)) return;
    // Prefer recognizable media URLs; still allow URLs without extension
    // (CDNs) when they come from <source type="video/..."> or currentSrc.
    const looksMedia =
      MEDIA_EXT.test(absolute) ||
      Boolean(mime && /^(video|audio)\//i.test(mime)) ||
      absolute === video.currentSrc ||
      absolute === video.src;
    if (!looksMedia) return;
    seen.add(absolute);
    out.push({
      url: absolute,
      mime,
      label,
      height: label ? guessHeightFromLabel(label) : guessHeightFromUrl(absolute),
      width: null,
    });
  };

  if (video.currentSrc) push(video.currentSrc, undefined, "current");
  if (video.src) push(video.src);

  video.querySelectorAll("source").forEach((el) => {
    const src = el.getAttribute("src") || "";
    const type = el.getAttribute("type") || undefined;
    const label =
      el.getAttribute("data-quality") ||
      el.getAttribute("label") ||
      el.getAttribute("size") ||
      undefined;
    const sizeAttr = el.getAttribute("size");
    const height = sizeAttr ? Number(sizeAttr) || null : null;
    push(src, type, label);
    if (height && out.length) {
      const last = out[out.length - 1];
      if (last && !last.height) last.height = height;
    }
  });

  return out;
}

function isProtected(video: HTMLVideoElement): boolean {
  try {
    if (video.mediaKeys) return true;
  } catch {
    /* */
  }
  // EME / DRM often leave no progressive http src
  const src = video.currentSrc || video.src || "";
  if (!src && video.querySelectorAll("source").length === 0) {
    // Likely MSE-only — not a direct progressive file
    return false; // handled as unsupported below
  }
  return false;
}

function pageTitleNear(video: HTMLVideoElement): string {
  const fig = video.closest("figure, article, section, .video, [class*='video']");
  const heading = fig?.querySelector("h1,h2,h3,[class*='title']");
  const text = heading?.textContent?.trim();
  if (text) return text.slice(0, 160);
  if (document.title) return document.title.slice(0, 160);
  try {
    return new URL(location.href).hostname;
  } catch {
    return "video";
  }
}

/**
 * Analyze a single <video> element for downloadable HTTP media sources.
 * Does not invent formats. Returns unsupported when no progressive URL exists.
 */
export function analyzeVideoElement(video: HTMLVideoElement): DetectedWebVideo {
  const pageUrl = location.href;
  const title = pageTitleNear(video);

  if (isProtected(video)) {
    return {
      video,
      sources: [],
      title,
      pageUrl,
      protected: true,
      unsupportedReason: "Cette vidéo ne peut pas être téléchargée.",
    };
  }

  const sources = collectSources(video);
  if (sources.length === 0) {
    return {
      video,
      sources: [],
      title,
      pageUrl,
      protected: false,
      unsupportedReason: "Source vidéo non prise en charge.",
    };
  }

  // Sort highest quality first when height known
  sources.sort((a, b) => (b.height || 0) - (a.height || 0));

  return {
    video,
    sources,
    title,
    pageUrl,
    protected: false,
  };
}

export function isYouTubeHost(hostname = location.hostname): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "youtube.com" ||
    h === "www.youtube.com" ||
    h === "m.youtube.com" ||
    h === "youtu.be" ||
    h.endsWith(".youtube.com")
  );
}

const EMBED_HINT =
  /embed|player|video|stream|watch|uqload|voe|dood|mixdrop|mxdrop|abstream|vidara|vidfhd|turbovid|hgcloud|filemoon|streamtape|ok\.ru|dailymotion|vimeo|larhu|dhtpre|hs2|vidhide|luluvdo|streamwish|filelions|vidmoly|mp4upload|upstream|d0o0d/i;

export function isLikelyVideoIframe(iframe: HTMLIFrameElement): boolean {
  const src =
    iframe.currentSrc ||
    iframe.src ||
    iframe.getAttribute("data-src") ||
    iframe.getAttribute("data-lazy-src") ||
    iframe.getAttribute("data-url") ||
    "";
  if (!src || src.startsWith("about:") || src.startsWith("javascript:")) {
    return false;
  }
  try {
    const u = new URL(src, location.href);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (isYouTubeHost(u.hostname)) return false;
  } catch {
    return false;
  }
  const rect = iframe.getBoundingClientRect();
  // Tiny iframes (ads / trackers) — skip when already laid out
  if (rect.width > 0 && rect.height > 0 && (rect.width < 200 || rect.height < 120)) {
    return false;
  }
  const allow =
    iframe.allow || iframe.getAttribute("allow") || "";
  const hay = `${src} ${iframe.className} ${iframe.id} ${iframe.name || ""} ${allow}`;
  if (EMBED_HINT.test(hay) || /\/e\/|\/embed\/|\/v\/|\/play\//i.test(src)) {
    return true;
  }
  // Large player-sized frame without a known host keyword (common on aggregator sites)
  if (rect.width >= 320 && rect.height >= 180) return true;
  // Not laid out yet — keep if allow includes autoplay/fullscreen (typical video embeds)
  if (rect.width === 0 && rect.height === 0) {
    return /autoplay|fullscreen|encrypted-media|picture-in-picture/i.test(allow);
  }
  return false;
}

export function analyzeIframeEmbed(iframe: HTMLIFrameElement): DetectedWebVideo {
  const raw =
    iframe.src ||
    iframe.getAttribute("data-src") ||
    iframe.getAttribute("data-lazy-src") ||
    "";
  let absolute = "";
  try {
    absolute = new URL(raw, location.href).toString();
  } catch {
    absolute = "";
  }
  const title = pageTitleNear(iframe as unknown as HTMLVideoElement);
  if (!absolute) {
    return {
      video: null,
      sources: [],
      title,
      pageUrl: location.href,
      protected: false,
      unsupportedReason: "Source vidéo non prise en charge.",
      preferYtDlp: true,
    };
  }
  return {
    video: null,
    sources: [{ url: absolute, label: "Lecteur intégré", height: null }],
    title,
    pageUrl: location.href,
    protected: false,
    preferYtDlp: true,
  };
}
