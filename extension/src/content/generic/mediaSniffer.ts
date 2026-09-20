/**
 * Detect progressive / HLS media URLs loaded by the page (player network).
 * Used when yt-dlp cannot extract formats from an embed page URL.
 */

export type SniffedMedia = {
  url: string;
  height: number | null;
  kind: "hls" | "progressive";
};

const MEDIA_URL_RE =
  /\.(m3u8|mp4|m4v|webm|mov|mkv|m4a|mp3)(\?|#|$)/i;
const HLS_HINT_RE = /\/hls\/|\/playlist|\.m3u8|manifest\.mpd|\/media\//i;

function isHttp(url: string): boolean {
  try {
    const u = new URL(url, location.href);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function classify(url: string): SniffedMedia["kind"] | null {
  if (/\.m3u8(\?|#|$)/i.test(url) || /\/hls\//i.test(url)) return "hls";
  if (MEDIA_URL_RE.test(url)) return "progressive";
  if (HLS_HINT_RE.test(url)) return "hls";
  return null;
}

export function collectSniffedMedia(): SniffedMedia[] {
  const out = new Map<string, SniffedMedia>();

  const add = (raw: string, height: number | null = null) => {
    if (!raw || !isHttp(raw)) return;
    let absolute: string;
    try {
      absolute = new URL(raw, location.href).toString();
    } catch {
      return;
    }
    if (/^blob:|^data:/i.test(absolute)) return;
    const kind = classify(absolute);
    if (!kind) return;
    const prev = out.get(absolute);
    if (!prev) {
      out.set(absolute, { url: absolute, height, kind });
      return;
    }
    if (height && !prev.height) {
      out.set(absolute, { ...prev, height });
    }
  };

  document.querySelectorAll("video").forEach((video) => {
    const h = video.videoHeight > 0 ? video.videoHeight : null;
    if (video.currentSrc) add(video.currentSrc, h);
    if (video.src) add(video.src, h);
    video.querySelectorAll("source").forEach((el) => {
      const src = el.getAttribute("src");
      if (src) add(src, h);
    });
  });

  try {
    for (const entry of performance.getEntriesByType("resource")) {
      add((entry as PerformanceResourceTiming).name);
    }
  } catch {
    /* */
  }

  return Array.from(out.values());
}

/** Parse an HLS master playlist into height → variant URL. */
export async function parseHlsMaster(
  masterUrl: string,
): Promise<{ height: number; url: string }[]> {
  let text: string;
  try {
    const res = await fetch(masterUrl, { credentials: "omit" });
    if (!res.ok) return [];
    text = await res.text();
  } catch {
    return [];
  }

  if (!/#EXT-X-STREAM-INF/i.test(text)) {
    // Media playlist only — no variants
    return [];
  }

  const lines = text.split(/\r?\n/);
  const out: { height: number; url: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || "";
    if (!line.startsWith("#EXT-X-STREAM-INF:")) continue;
    const resMatch = /RESOLUTION=(\d+)x(\d+)/i.exec(line);
    const height = resMatch ? Number(resMatch[2]) : 0;
    const next = (lines[i + 1] || "").trim();
    if (!next || next.startsWith("#")) continue;
    try {
      const variant = new URL(next, masterUrl).toString();
      if (height > 0) out.push({ height, url: variant });
    } catch {
      /* */
    }
  }

  // Deduplicate by height (keep first / usually highest bandwidth listed)
  const byH = new Map<number, string>();
  for (const row of out.sort((a, b) => b.height - a.height)) {
    if (!byH.has(row.height)) byH.set(row.height, row.url);
  }
  return Array.from(byH.entries()).map(([height, url]) => ({ height, url }));
}

export async function sniffFormatsForPanel(): Promise<{
  mediaUrl: string;
  formats: {
    id: string;
    height: number;
    url: string;
    ext: string;
    codec: string;
    hasAudio: boolean;
    estimatedSize: null;
    displaySize: null;
    sizeEstimated: true;
    resolution: string;
  }[];
}> {
  const sniffed = collectSniffedMedia();
  const formats: Awaited<ReturnType<typeof sniffFormatsForPanel>>["formats"] =
    [];

  for (const item of sniffed) {
    if (item.kind === "progressive") {
      const height = item.height || 0;
      formats.push({
        id: `prog:${item.url}`,
        height,
        url: item.url,
        ext: "mp4",
        codec: "unknown",
        hasAudio: true,
        estimatedSize: null,
        displaySize: null,
        sizeEstimated: true,
        resolution: height ? `${height}p` : "best",
      });
      continue;
    }

    const variants = await parseHlsMaster(item.url);
    if (variants.length) {
      for (const v of variants) {
        formats.push({
          id: `hls:${v.height}:${v.url}`,
          height: v.height,
          url: v.url,
          ext: "mp4",
          codec: "unknown",
          hasAudio: true,
          estimatedSize: null,
          displaySize: null,
          sizeEstimated: true,
          resolution: `${v.height}p`,
        });
      }
    } else {
      // Single media playlist / unknown — still downloadable via yt-dlp
      formats.push({
        id: `hls:${item.url}`,
        height: item.height || 0,
        url: item.url,
        ext: "mp4",
        codec: "unknown",
        hasAudio: true,
        estimatedSize: null,
        displaySize: null,
        sizeEstimated: true,
        resolution: item.height ? `${item.height}p` : "best",
      });
    }
  }

  // Prefer entries with known height; one row per height
  const byHeight = new Map<number, (typeof formats)[0]>();
  const unknown: typeof formats = [];
  for (const f of formats) {
    if (f.height > 0) {
      const prev = byHeight.get(f.height);
      if (!prev) byHeight.set(f.height, f);
    } else {
      unknown.push(f);
    }
  }
  const ranked = Array.from(byHeight.values()).sort(
    (a, b) => b.height - a.height,
  );
  if (ranked.length) {
    return {
      mediaUrl: ranked[0]!.url,
      formats: ranked,
    };
  }
  if (unknown.length) {
    return { mediaUrl: unknown[0]!.url, formats: unknown.slice(0, 1) };
  }
  return { mediaUrl: "", formats: [] };
}

export function startMediaSniffer(
  onUpdate: (items: SniffedMedia[]) => void,
): () => void {
  const report = () => {
    try {
      onUpdate(collectSniffedMedia());
    } catch {
      /* */
    }
  };
  report();
  let po: PerformanceObserver | null = null;
  try {
    po = new PerformanceObserver(() => report());
    po.observe({ entryTypes: ["resource"] });
  } catch {
    /* */
  }
  const iv = window.setInterval(report, 1500);
  const onVid = () => report();
  document.addEventListener("loadedmetadata", onVid, true);
  document.addEventListener("play", onVid, true);

  return () => {
    po?.disconnect();
    window.clearInterval(iv);
    document.removeEventListener("loadedmetadata", onVid, true);
    document.removeEventListener("play", onVid, true);
  };
}
