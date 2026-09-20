/**
 * In-memory media URL registry per tab (filled by webRequest + content sniffers).
 */
export type TabMediaEntry = {
  url: string;
  kind: "hls" | "progressive" | "unknown";
  height?: number | null;
  seenAt: number;
};

const byTab = new Map<number, Map<string, TabMediaEntry>>();

const MEDIA_RE =
  /\.(m3u8|mp4|m4v|webm|mov|mkv|m4a|mp3)(\?|#|$)/i;
const HLS_HINT = /\/hls\/|\.m3u8|manifest|playlist/i;

function classify(url: string): TabMediaEntry["kind"] | null {
  if (/\.m3u8(\?|#|$)/i.test(url) || /\/hls\//i.test(url)) return "hls";
  if (MEDIA_RE.test(url)) return "progressive";
  if (HLS_HINT.test(url)) return "hls";
  return null;
}

export function isMediaRequestUrl(url: string): boolean {
  return classify(url) !== null;
}

export function registerTabMedia(
  tabId: number,
  url: string,
  height?: number | null,
): void {
  if (tabId < 0) return;
  const kind = classify(url);
  if (!kind) return;
  let map = byTab.get(tabId);
  if (!map) {
    map = new Map();
    byTab.set(tabId, map);
  }
  const prev = map.get(url);
  map.set(url, {
    url,
    kind,
    height: height ?? prev?.height ?? null,
    seenAt: Date.now(),
  });
  // Cap per tab
  if (map.size > 40) {
    const sorted = [...map.values()].sort((a, b) => a.seenAt - b.seenAt);
    for (const old of sorted.slice(0, map.size - 40)) {
      map.delete(old.url);
    }
  }
}

export function clearTabMedia(tabId: number): void {
  byTab.delete(tabId);
}

export function getTabMedia(tabId: number): TabMediaEntry[] {
  const map = byTab.get(tabId);
  if (!map) return [];
  const now = Date.now();
  return [...map.values()]
    .filter((e) => now - e.seenAt < 15 * 60 * 1000)
    .sort((a, b) => b.seenAt - a.seenAt);
}

export function candidateUrlsForAnalyze(
  tabId: number | undefined,
  embedUrl: string,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (u: string) => {
    if (!u || seen.has(u)) return;
    seen.add(u);
    out.push(u);
  };
  if (typeof tabId === "number") {
    for (const e of getTabMedia(tabId)) push(e.url);
  }
  push(embedUrl);
  return out;
}
