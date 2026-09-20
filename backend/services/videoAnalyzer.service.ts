import {
  positiveNumber,
  resolveDownloadSize,
  type SizeMetadata,
} from "../../src/utils/fileSize";
import { run, ytdlp, common } from "./process";
import { resolveCookiesFile } from "./youtubeCookies";
import { youtubeUrl } from "../../src/utils/format";
import type { Analysis } from "../../src/types";
const cache = new Map<string, { data: Analysis; expires: number }>();

const BOT_RE =
  /confirm.*(you.?re|you are).*not a bot|Sign in to confirm|cookies-from-browser|pass cookies/i;

/** Clients that sometimes work on datacenter IPs without cookies. */
const FALLBACK_CLIENTS_NO_COOKIES = [
  "android_vr,tv,web_embedded",
  "tv,ios,android",
];

/** Prefer cookie-compatible clients when Netscape cookies are loaded. */
const FALLBACK_CLIENTS_WITH_COOKIES = [
  "web,mweb,tv",
  "mweb,tv,web_safari",
  "web,mweb,ios,tv",
];

export function clearAnalysisCache() {
  cache.clear();
}

export async function analyze(input: string): Promise<Analysis> {
  const url = youtubeUrl(input);
  if (!url) throw new Error("INVALID_URL");
  const hit = cache.get(url);
  if (hit && hit.expires > Date.now()) return hit.data;

  const raw = await dumpJsonWithFallbacks(url);
  const data = buildAnalysis(raw, url);

  // If only progressive low-res came back, retry with web/mweb (needs POT).
  const heights = new Set(data.formats.map((f) => f.height));
  if (heights.size < 3) {
    try {
      const richer = await dumpJson(url, [
        "--extractor-args",
        "youtube:player_client=web,mweb,web_safari,tv,ios",
      ]);
      const enriched = buildAnalysis(richer, url);
      if (new Set(enriched.formats.map((f) => f.height)).size > heights.size) {
        cache.set(url, { data: enriched, expires: Date.now() + 300000 });
        return enriched;
      }
    } catch {
      /* keep first successful analysis */
    }
  }

  if (cache.size >= 100) cache.delete(cache.keys().next().value!);
  cache.set(url, { data, expires: Date.now() + 300000 });
  return data;
}

async function dumpJsonWithFallbacks(url: string) {
  try {
    return await dumpJson(url);
  } catch (first) {
    const msg = String(first);
    if (!BOT_RE.test(msg) && !/page needs to be reloaded|Failed to extract|Unable to extract/i.test(msg)) {
      throw first;
    }

    const hasCookies = !!resolveCookiesFile();
    const clientsList = hasCookies
      ? FALLBACK_CLIENTS_WITH_COOKIES
      : FALLBACK_CLIENTS_NO_COOKIES;

    console.warn(
      "[analyze] YouTube extract failed — retrying with alternate clients…",
      { hasCookies },
    );
    let last: unknown = first;
    for (const clients of clientsList) {
      try {
        return await dumpJson(url, [
          "--extractor-args",
          `youtube:player_client=${clients}`,
        ]);
      } catch (e) {
        last = e;
      }
    }
    throw last;
  }
}

async function dumpJson(url: string, extraArgs: string[] = []) {
  const base = common();
  // Replace youtube: extractor-args if caller provides them; keep POT args
  let args = [...base];
  if (extraArgs.includes("--extractor-args")) {
    const drop = new Set<number>();
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--extractor-args") {
        const value = args[i + 1] || "";
        if (value.startsWith("youtube:")) {
          drop.add(i);
          drop.add(i + 1);
        }
      }
    }
    args = args.filter((_, i) => !drop.has(i));
    args.push(...extraArgs);
  }
  try {
    return JSON.parse(
      await run(ytdlp(), [
        ...args,
        "--dump-single-json",
        "--skip-download",
        "--",
        url,
      ]),
    );
  } catch (first) {
    const msg = String(first);
    if (
      /could not (copy|find)|failed to (load|decrypt)|Unable to find|Permission denied|database is locked|No such file/i.test(
        msg,
      ) &&
      (process.env.YT_DLP_COOKIES_FROM_BROWSER ||
        process.env.YT_DLP_COOKIES ||
        process.env.YT_DLP_COOKIES_CONTENT ||
        process.env.YT_DLP_COOKIES_BASE64)
    ) {
      console.warn("Cookies indisponibles, nouvel essai sans cookies…");
      const fallback = args.filter(
        (a, i, arr) =>
          a !== "--cookies-from-browser" &&
          arr[i - 1] !== "--cookies-from-browser" &&
          a !== "--cookies" &&
          arr[i - 1] !== "--cookies",
      );
      return JSON.parse(
        await run(ytdlp(), [
          ...fallback,
          "--dump-single-json",
          "--skip-download",
          "--",
          url,
        ]),
      );
    }
    throw first;
  }
}

function buildAnalysis(raw: any, url: string): Analysis {
  if (raw.is_live || raw.duration > 7200) throw new Error("LIMIT_DURATION");
  const rawVideo = (raw.formats || []).filter(
    (f: any) => f.vcodec && f.vcodec !== "none" && f.height && !f.has_drm,
  );
  if (process.env.NODE_ENV !== "production") {
    const heights = [
      ...new Set(
        rawVideo.map((f: { height: number }) => f.height as number),
      ),
    ].sort((a, b) => (b as number) - (a as number));
    const sample = rawVideo.slice(0, 15).map(
      (f: {
        format_id: string;
        height: number;
        ext: string;
        protocol?: string;
        has_drm?: boolean;
      }) =>
        `${f.format_id}@${f.height}p/${f.ext}/${f.protocol || "?"}/drm=${!!f.has_drm}`,
    );
    console.log(
      "[analyze]",
      raw.id,
      "rawVideoFormats=",
      rawVideo.length,
      "heights=",
      heights.slice(0, 12),
      "sample=",
      sample,
      "totalFormats=",
      (raw.formats || []).length,
      "cookies=",
      process.env.YT_DLP_COOKIES_FROM_BROWSER ||
        process.env.YT_DLP_COOKIES ||
        "none",
    );
  }
  const audioStreams = (raw.formats || []).filter(
    (f: any) =>
      f.acodec &&
      f.acodec !== "none" &&
      f.vcodec === "none" &&
      !f.has_drm &&
      f.format_id &&
      /^[\w.+\/=-]+$/.test(String(f.format_id)),
  );
  const metadata = (f: any): SizeMetadata => ({
    filesize: positiveNumber(f.filesize),
    filesizeApprox: positiveNumber(f.filesize_approx),
    videoBitrate: positiveNumber(f.vbr),
    audioBitrate: positiveNumber(f.abr),
    totalBitrate: positiveNumber(f.tbr),
  });
  const formats = (raw.formats || [])
    .filter(
      (f: any) =>
        f.vcodec &&
        f.vcodec !== "none" &&
        f.height &&
        f.format_id &&
        !f.has_drm &&
        // Allow common yt-dlp ids (137, 96, 248+251, etc.)
        /^[\w.+\/=-]+$/.test(String(f.format_id)),
    )
    .map((f: any) => {
      const hasAudio = !!f.acodec && f.acodec !== "none";
      const compatible =
        f.ext === "mp4"
          ? audioStreams.filter((a: any) => a.ext === "m4a")
          : audioStreams;
      const audio = (compatible.length ? compatible : audioStreams).at(-1);
      const source = metadata(f);
      const finalSize = resolveDownloadSize(
        source,
        raw.duration,
        hasAudio ? undefined : audio ? metadata(audio) : null,
      );
      return {
        id: f.format_id,
        width: f.width,
        height: f.height,
        resolution: `${f.height}p`,
        ext: f.ext,
        fps: f.fps,
        ...source,
        videoBitrate:
          source.videoBitrate ?? (!hasAudio ? source.totalBitrate : undefined),
        audioBitrate: hasAudio
          ? source.audioBitrate
          : (positiveNumber(audio?.abr) ?? positiveNumber(audio?.tbr)),
        ...finalSize,
        size: source.filesize ?? source.filesizeApprox,
        audioFormatId: hasAudio ? undefined : audio?.format_id,
        codec: f.vcodec,
        hdr: f.dynamic_range !== "SDR" ? f.dynamic_range : undefined,
        hasAudio,
      };
    })
    .sort(
      (a: any, b: any) => b.height - a.height || (b.fps || 0) - (a.fps || 0),
    );
  const data: Analysis = {
    video: {
      id: raw.id,
      url,
      title: raw.title,
      thumbnail: raw.thumbnail,
      duration: raw.duration || 0,
      channel: raw.channel || raw.uploader,
      views: raw.view_count,
      date: raw.upload_date,
      description: raw.description,
    },
    formats,
    audioFormats: (raw.formats || [])
      .filter(
        (f: any) => f.acodec && f.acodec !== "none" && f.vcodec === "none",
      )
      .map((f: any) => ({
        id: f.format_id,
        codec: f.acodec,
        bitrate: f.abr,
        language: f.language,
      })),
    subtitles: [],
    translationAvailable: !!process.env.TRANSLATE_URL,
  };
  for (const [automatic, tracks] of [
    [false, raw.subtitles],
    [true, raw.automatic_captions],
  ] as const) {
    for (const [language, entries] of Object.entries(tracks || {}) as [
      string,
      any[],
    ][]) {
      if (language === "live_chat" || !/^[\w-]+$/.test(language)) continue;
      data.subtitles.push({
        id: `${automatic ? "auto" : "official"}:${language}`,
        language,
        name: entries[0]?.name || language,
        automatic,
      });
    }
  }
  return data;
}

