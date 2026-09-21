import type { DownloadJob, DownloadSnapshot } from "@nova/shared";
import {
  getDownloadPath,
  getExtensionForDownload,
  isActiveDownloadState,
  sanitizeFilename,
  type NovaDownloadKind,
} from "@nova/shared";
import { browserApi } from "../utils/browserApi";
import { debugLog } from "../utils/debug";
import { assertBrowserDownloadUrl } from "../services/novaApi";
import {
  analyzeOnce,
  cancelServerMaterialize,
  clearCachedAnalysis,
  pauseServerMaterialize,
  prepareDownload,
  waitUntilMaterialized,
} from "../services/download";
import { analyzeGenericMedia, prepareGenericMedia } from "../services/genericMediaAnalyzer";
import {
  candidateUrlsForAnalyze,
  clearTabMedia,
  isMediaRequestUrl,
  registerTabMedia,
} from "./tabMediaRegistry";
import {
  activeCount,
  applyChromeItem,
  createJobId,
  DOWNLOADS_STORAGE_KEY,
  fromPersisted,
  pruneJobs,
  sortJobs,
  toPersisted,
} from "../downloads/downloadManager";
import {
  createDownloadSnapshot,
  snapshotToJob,
  type StartDownloadPayload,
} from "../downloads/downloadSnapshot";
import {
  DEFAULT_SETTINGS,
  type ExtensionMessage,
  type ExtensionResponse,
  type ExtensionSettings,
} from "../types/api";

/** In-memory job list (restored from storage on demand). Source of truth. */
let jobs: DownloadJob[] = [];
let jobsLoaded = false;
/** Abort in-flight prepare/materialize waits keyed by job id. */
const jobAbortControllers = new Map<string, AbortController>();
/** Stream downloadUrl for server cancel, keyed by job id. */
const jobStreamUrls = new Map<string, string>();
/** Jobs soft-paused during prepare (resume continues same token). */
const pausedJobIds = new Set<string>();

async function loadJobs(): Promise<DownloadJob[]> {
  if (jobsLoaded) return jobs;
  try {
    const stored = await browserApi.storageLocalGet({
      [DOWNLOADS_STORAGE_KEY]: [] as unknown[],
    });
    const raw = stored[DOWNLOADS_STORAGE_KEY];
    if (Array.isArray(raw)) {
      jobs = pruneJobs(
        raw.map((row) =>
          fromPersisted(row as Parameters<typeof fromPersisted>[0]),
        ),
      );
    }
  } catch (e) {
    debugLog("loadJobs failed", e);
  }
  jobsLoaded = true;
  return jobs;
}

async function persistJobs(): Promise<void> {
  jobs = pruneJobs(jobs);
  try {
    await browserApi.storageLocalSet({
      [DOWNLOADS_STORAGE_KEY]: jobs.map(toPersisted),
    });
  } catch (e) {
    debugLog("persistJobs failed", e);
  }
  await updateBadge();
}

async function updateBadge(): Promise<void> {
  const n = activeCount(jobs);
  try {
    const action = browserApi.action;
    if (!action?.setBadgeText) return;
    await action.setBadgeText({ text: n > 0 ? String(n) : "" });
    if (action.setBadgeBackgroundColor) {
      await action.setBadgeBackgroundColor({ color: "#B6FF2F" });
    }
    if (action.setBadgeTextColor) {
      await action.setBadgeTextColor({ color: "#23262F" });
    }
  } catch {
    /* Firefox / missing permission */
  }
}

function upsertJob(job: DownloadJob): void {
  const idx = jobs.findIndex((j) => j.id === job.id);
  if (idx >= 0) {
    // Never overwrite snapshot identity fields from a partial update
    const prev = jobs[idx]!;
    jobs[idx] = {
      ...job,
      videoId: prev.videoId || job.videoId,
      videoUrl: prev.videoUrl || job.videoUrl,
      title: prev.title || job.title,
      channel: prev.channel ?? job.channel,
      thumbnail: prev.thumbnail ?? job.thumbnail,
      type: prev.type,
      quality: prev.quality ?? job.quality,
      format: prev.format ?? job.format,
      formatId: prev.formatId ?? job.formatId,
      audioFormatId: prev.audioFormatId ?? job.audioFormatId,
      bitrate: prev.bitrate ?? job.bitrate,
      language: prev.language ?? job.language,
      targetLanguage: prev.targetLanguage ?? job.targetLanguage,
      resolution: prev.resolution ?? job.resolution,
      fps: prev.fps ?? job.fps,
      container: prev.container ?? job.container,
      codec: prev.codec ?? job.codec,
    };
  } else {
    jobs.unshift(job);
  }
  jobs = sortJobs(jobs);
}

function findByChromeId(chromeId: number): DownloadJob | undefined {
  return jobs.find((j) => j.chromeDownloadId === chromeId);
}

function broadcast(job: DownloadJob): void {
  const message = {
    type: "DOWNLOAD_UPDATED",
    job,
  } satisfies ExtensionResponse;
  // Extension pages (popup / options)
  void browserApi.runtime.sendMessage(message).catch(() => {
    /* no listeners */
  });
  // Persist ping so content scripts can react via storage.onChanged
  void browserApi
    .storageLocalSet({
      nova_dl_broadcast: { job, at: Date.now() },
    })
    .catch(() => {
      /* */
    });
  // Content scripts (YouTube panel)
  void browserApi.tabs.query({}).then((tabs) => {
    for (const tab of tabs) {
      if (typeof tab.id !== "number") continue;
      void browserApi.sendTabMessage(tab.id, message).catch(() => {
        /* tab without content script */
      });
    }
  });
}

async function refreshJobFromChrome(job: DownloadJob): Promise<DownloadJob> {
  if (typeof job.chromeDownloadId !== "number") return job;
  try {
    const items = await browserApi.downloadsSearch({ id: job.chromeDownloadId });
    const item = items[0];
    if (!item) {
      if (isActiveDownloadState(job.state) && job.state !== "preparing") {
        const next = {
          ...job,
          state: "interrupted" as const,
          error: "Téléchargement introuvable dans Chrome.",
          completedAt: job.completedAt || Date.now(),
        };
        upsertJob(next);
        return next;
      }
      return job;
    }
    const next = applyChromeItem(job, item);
    upsertJob(next);
    return next;
  } catch (e) {
    debugLog("refreshJobFromChrome", e);
    return job;
  }
}

async function refreshAllFromChrome(): Promise<DownloadJob[]> {
  await loadJobs();
  const refreshed: DownloadJob[] = [];
  for (const job of jobs) {
    refreshed.push(await refreshJobFromChrome(job));
  }
  jobs = pruneJobs(refreshed);
  await persistJobs();
  return jobs;
}

async function loadSettings(): Promise<ExtensionSettings> {
  const stored = await browserApi.storageGet({
    novaSettings: DEFAULT_SETTINGS,
  });
  const raw = { ...DEFAULT_SETTINGS, ...(stored.novaSettings as ExtensionSettings) };
  // Legacy askWhereToSave must never resurface — always auto-save.
  const { askWhereToSave: _removed, ...rest } = raw as ExtensionSettings & {
    askWhereToSave?: boolean;
  };
  void _removed;
  return rest;
}

async function saveSettings(
  partial: Partial<ExtensionSettings>,
): Promise<ExtensionSettings> {
  const current = await loadSettings();
  const next = { ...current, ...partial };
  await browserApi.storageSet({ novaSettings: next });
  return next;
}

function kindFromType(type: DownloadJob["type"]): NovaDownloadKind {
  if (type === "audio") return "audio";
  if (type === "subtitle") return "subtitles";
  return "video";
}

function ensureMediaExtension(
  kind: NovaDownloadKind,
  filename: string,
): string {
  const safe = sanitizeFilename(filename);
  const lower = safe.toLowerCase();
  if (kind === "video") {
    if (
      lower.endsWith(".mp4") ||
      lower.endsWith(".webm") ||
      lower.endsWith(".mkv")
    ) {
      return safe;
    }
    return `${safe}.${getExtensionForDownload("video")}`;
  }
  if (kind === "audio") {
    if (lower.endsWith(".mp3")) return safe;
    return `${safe}.${getExtensionForDownload("audio")}`;
  }
  if (lower.endsWith(".srt")) return safe;
  return `${safe}.${getExtensionForDownload("subtitles")}`;
}

async function startBrowserDownload(options: {
  downloadUrl: string;
  kind: NovaDownloadKind;
  filename: string;
}): Promise<{ downloadId: number; filename: string }> {
  const parsed = assertBrowserDownloadUrl(options.downloadUrl);
  const baseName = ensureMediaExtension(options.kind, options.filename);
  const filename = getDownloadPath(options.kind, baseName);

  console.log("[DOWNLOAD] chrome.downloads.download", {
    url: parsed.toString(),
    filename,
    saveAs: false,
  });

  const downloadId = await browserApi.download({
    url: parsed.toString(),
    filename,
    saveAs: false,
    conflictAction: "uniquify",
  });

  if (typeof downloadId !== "number") {
    throw new Error("Chrome n’a pas démarré le téléchargement.");
  }

  return { downloadId, filename };
}

function extractStreamTokenId(downloadUrl: string): string | undefined {
  try {
    const u = new URL(downloadUrl);
    const m = u.pathname.match(
      /\/download\/(?:generic\/)?stream\/([^/?#]+)/,
    );
    return m?.[1];
  } catch {
    return undefined;
  }
}

/**
 * Start a download from an immutable snapshot.
 * Never reads the current YouTube page URL / selection.
 * Always saveAs: false → Downloads/Nova Downloader/{Vedio|Music|Sous-titre}/
 */
async function startFromSnapshot(
  snapshot: DownloadSnapshot,
): Promise<{ job: DownloadJob }> {
  await loadJobs();
  const kind = kindFromType(snapshot.type);

  let job = snapshotToJob(snapshot);
  upsertJob(job);
  await persistJobs();
  broadcast(job);

  const abort = new AbortController();
  jobAbortControllers.set(job.id, abort);

  console.log("[NOVA DOWNLOAD] snapshot", {
    jobId: snapshot.jobId,
    videoId: snapshot.videoId,
    formatId: snapshot.formatId,
    quality: snapshot.quality,
    type: snapshot.type,
  });

  try {
    let prepared: { downloadUrl: string; filename: string };
    if (snapshot.type === "video") {
      if (!snapshot.formatId) throw new Error("FORMAT_UNAVAILABLE");
      prepared = await prepareDownload({
        type: "video",
        videoUrl: snapshot.videoUrl,
        formatId: snapshot.formatId,
      });
    } else if (snapshot.type === "audio") {
      prepared = await prepareDownload({
        type: "audio",
        videoUrl: snapshot.videoUrl,
        bitrate: snapshot.bitrate || "0",
      });
    } else {
      if (!snapshot.language) throw new Error("SUBTITLE_UNAVAILABLE");
      prepared = await prepareDownload({
        type: "subtitles",
        videoUrl: snapshot.videoUrl,
        language: snapshot.language,
        targetLanguage: snapshot.targetLanguage,
      });
    }

    if (abort.signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    // For audio, prefer server filename (includes "Chaîne - Titre").
    // Videos keep the snapshot name (title - heightp).
    const baseName = ensureMediaExtension(
      kind,
      kind === "audio"
        ? prepared.filename || snapshot.filename
        : snapshot.filename || prepared.filename,
    );
    const intendedPath = getDownloadPath(kind, baseName);
    const streamTokenId = extractStreamTokenId(prepared.downloadUrl);
    jobStreamUrls.set(job.id, prepared.downloadUrl);

    const audioTitleFromFile =
      kind === "audio"
        ? baseName.replace(/\.mp3$/i, "").trim()
        : undefined;

    job = {
      ...job,
      state: "preparing",
      streamTokenId,
      filename: intendedPath,
      ...(audioTitleFromFile ? { title: audioTitleFromFile } : {}),
      estimatedTotalBytes:
        prepared.estimatedSize ?? snapshot.estimatedSize ?? null,
      progress: 0,
    };
    upsertJob(job);
    await persistJobs();
    broadcast(job);

    // Build the file server-side first so chrome.downloads gets Content-Length
    // immediately (real 0–100% bar, no Save As hang after a long wait).
    if (snapshot.type === "video" || snapshot.type === "audio") {
      await waitUntilMaterialized(
        prepared.downloadUrl,
        (info) => {
          const pct =
            typeof info.prepareProgress === "number"
              ? info.prepareProgress
              : job.progress;
          job = {
            ...job,
            state: "preparing",
            progress: pct,
            totalBytes: info.totalBytes ?? job.totalBytes,
            estimatedTotalBytes:
              info.estimatedTotalBytes ??
              info.totalBytes ??
              job.estimatedTotalBytes,
            speedBytesPerSecond: info.speedBytesPerSecond || 0,
            etaSeconds: info.etaSeconds,
          };
          upsertJob(job);
          void persistJobs();
          broadcast(job);
        },
        abort.signal,
      );
    }

    if (abort.signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    job = {
      ...job,
      state: "starting",
      progress: typeof job.progress === "number" ? job.progress : null,
    };
    upsertJob(job);
    await persistJobs();
    broadcast(job);

    const { filename, downloadId } = await startBrowserDownload({
      downloadUrl: prepared.downloadUrl,
      kind,
      filename: baseName,
    });

    console.log("[NOVA DOWNLOAD] chrome download id:", downloadId);

    // chrome.downloads.download() — keep prepare % until Chrome reports bytes.
    job = {
      ...job,
      chromeDownloadId: downloadId,
      filename,
      state: "starting",
      bytesReceived: 0,
    };
    upsertJob(job);
    await persistJobs();
    broadcast(job);

    job = await refreshJobFromChrome(job);
    await persistJobs();
    broadcast(job);

    return { job };
  } catch (e) {
    const aborted =
      (e instanceof DOMException && e.name === "AbortError") ||
      (e instanceof Error && e.name === "AbortError");
    if (aborted) {
      const current = jobs.find((j) => j.id === job.id);
      if (
        current &&
        (current.state === "cancelled" || current.state === "paused")
      ) {
        return { job: current };
      }
      if (pausedJobIds.has(job.id)) {
        job = {
          ...job,
          state: "paused",
          error: undefined,
          errorCode: undefined,
          speedBytesPerSecond: 0,
          etaSeconds: null,
        };
        upsertJob(job);
        await persistJobs();
        broadcast(job);
        return { job };
      }
      job = {
        ...job,
        state: "cancelled",
        error: "Téléchargement annulé.",
        errorCode: "USER_CANCELED",
        progress: job.progress ?? 0,
        completedAt: Date.now(),
        speedBytesPerSecond: 0,
        etaSeconds: null,
      };
      upsertJob(job);
      await persistJobs();
      broadcast(job);
      return { job };
    }
    const error =
      e instanceof Error
        ? e.message
        : "Le téléchargement n’a pas pu être préparé.";
    const isServer =
      error.includes("indisponible") ||
      error.includes("contacter") ||
      error.includes("Failed to fetch") ||
      error.includes("NetworkError");
    job = {
      ...job,
      state: "failed",
      error: isServer
        ? "Serveur NovaDownloader indisponible."
        : error,
      errorCode: isServer ? "SERVER_UNAVAILABLE" : "PREPARE_FAILED",
      progress: 0,
      bytesReceived: 0,
      totalBytes: null,
      completedAt: Date.now(),
      speedBytesPerSecond: 0,
      etaSeconds: null,
    };
    upsertJob(job);
    await persistJobs();
    broadcast(job);
    throw new Error(job.error);
  } finally {
    jobAbortControllers.delete(job.id);
  }
}

function legacyMessageToPayload(
  message: Extract<
    ExtensionMessage,
    | { type: "DOWNLOAD_VIDEO" }
    | { type: "DOWNLOAD_AUDIO" }
    | { type: "DOWNLOAD_SUBTITLE" }
  >,
): StartDownloadPayload {
  if (message.type === "DOWNLOAD_VIDEO") {
    return {
      videoId: message.videoId || "unknown",
      videoUrl: message.videoUrl,
      title: message.title || message.filename || "YouTube",
      thumbnail: message.thumbnail,
      downloadType: "video",
      quality: message.quality,
      formatId: message.formatId,
      audioFormatId: message.audioFormatId,
      container: message.format,
      estimatedSize: message.estimatedTotalBytes ?? null,
      filename: message.filename,
    };
  }
  if (message.type === "DOWNLOAD_AUDIO") {
    return {
      videoId: message.videoId || "unknown",
      videoUrl: message.videoUrl,
      title: message.title || message.filename || "YouTube",
      thumbnail: message.thumbnail,
      downloadType: "audio",
      quality: message.quality,
      bitrate: message.bitrate,
      container: "mp3",
      estimatedSize: message.estimatedTotalBytes ?? null,
      filename: message.filename,
    };
  }
  return {
    videoId: message.videoId || "unknown",
    videoUrl: message.videoUrl,
    title: message.title || message.filename || "YouTube",
    thumbnail: message.thumbnail,
    downloadType: "subtitle",
    quality: message.quality,
    language: message.language,
    targetLanguage: message.targetLanguage,
    container: "srt",
    estimatedSize: message.estimatedTotalBytes ?? null,
    filename: message.filename,
  };
}

try {
  const downloads = browserApi.downloads;
  if (downloads?.onChanged) {
    downloads.onChanged.addListener((delta) => {
      void (async () => {
        console.log("[CHROME DOWNLOAD]", delta);
        await loadJobs();
        const job = findByChromeId(delta.id);
        if (!job) return;
        const next = await refreshJobFromChrome(job);
        await persistJobs();
        broadcast(next);
      })();
    });
  }
} catch (e) {
  debugLog("downloads.onChanged unavailable", e);
}

/** Capture real m3u8/mp4 URLs from embed players (yt-dlp often fails on host pages). */
try {
  const wr = (browserApi as unknown as { webRequest?: typeof chrome.webRequest })
    .webRequest;
  const api = (globalThis as { chrome?: typeof chrome }).chrome;
  const webRequest = wr || api?.webRequest;
  if (webRequest?.onCompleted) {
    webRequest.onCompleted.addListener(
      (details) => {
        if (details.tabId < 0) return;
        if (!isMediaRequestUrl(details.url)) return;
        registerTabMedia(details.tabId, details.url);
      },
      { urls: ["http://*/*", "https://*/*"] },
    );
  }
  if (api?.webRequest?.onBeforeRequest) {
    api.webRequest.onBeforeRequest.addListener(
      (details) => {
        if (details.tabId < 0) return;
        if (!isMediaRequestUrl(details.url)) return;
        registerTabMedia(details.tabId, details.url);
      },
      { urls: ["http://*/*", "https://*/*"] },
    );
  }
  api?.tabs?.onRemoved?.addListener((tabId) => {
    clearTabMedia(tabId);
  });
} catch (e) {
  debugLog("webRequest media sniff unavailable", e);
}

browserApi.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    void (async () => {
      try {
        switch (message.type) {
          case "PING":
            sendResponse({ type: "PONG" } satisfies ExtensionResponse);
            return;

          case "REGISTER_GENERIC_MEDIA": {
            const tabId = sender.tab?.id;
            if (typeof tabId === "number") {
              for (const url of message.payload.urls || []) {
                registerTabMedia(tabId, String(url));
              }
            }
            sendResponse({ type: "OK" } satisfies ExtensionResponse);
            return;
          }

          case "GET_SETTINGS": {
            const settings = await loadSettings();
            sendResponse({
              type: "SETTINGS",
              settings,
            } satisfies ExtensionResponse);
            return;
          }

          case "SAVE_SETTINGS": {
            const settings = await saveSettings(message.settings);
            sendResponse({
              type: "SETTINGS",
              settings,
            } satisfies ExtensionResponse);
            return;
          }

          case "ANALYZE_VIDEO": {
            try {
              clearCachedAnalysis(message.videoId);
              const data = await analyzeOnce(message.videoId, message.url);
              sendResponse({
                type: "ANALYZE_SUCCESS",
                videoId: message.videoId,
                data,
              } satisfies ExtensionResponse);
            } catch (e) {
              const error =
                e instanceof Error
                  ? e.message
                  : "Cette vidéo ne peut pas être analysée actuellement.";
              const offline =
                error.includes("contacter") ||
                error.includes("Failed to fetch") ||
                error.includes("NetworkError");
              sendResponse({
                type: "ANALYZE_ERROR",
                videoId: message.videoId,
                error: offline
                  ? "Impossible de contacter NovaDownloader."
                  : error,
              } satisfies ExtensionResponse);
            }
            return;
          }

          case "GET_DOWNLOADS": {
            const list = await refreshAllFromChrome();
            sendResponse({
              type: "DOWNLOADS",
              downloads: list,
              activeCount: activeCount(list),
            } satisfies ExtensionResponse);
            return;
          }

          case "GET_DOWNLOAD_STATUS": {
            await loadJobs();
            let job = jobs.find((j) => j.id === message.jobId);
            if (job) job = await refreshJobFromChrome(job);
            await persistJobs();
            sendResponse({
              type: "DOWNLOAD_STATUS",
              job: job || null,
            } satisfies ExtensionResponse);
            return;
          }

          case "PAUSE_DOWNLOAD": {
            await loadJobs();
            const job =
              jobs.find((j) => j.id === message.jobId) ||
              (typeof message.chromeDownloadId === "number"
                ? findByChromeId(message.chromeDownloadId)
                : undefined);
            if (!job) {
              sendResponse({ type: "OK" } satisfies ExtensionResponse);
              return;
            }

            if (typeof job.chromeDownloadId === "number") {
              await browserApi.downloadsPause(job.chromeDownloadId);
              const next = await refreshJobFromChrome(job);
              await persistJobs();
              broadcast(next);
            } else {
              // Preparing: pause server (keep partial files) — resume continues.
              pausedJobIds.add(job.id);
              jobAbortControllers.get(job.id)?.abort();
              const url = jobStreamUrls.get(job.id);
              if (url) await pauseServerMaterialize(url);
              const next: DownloadJob = {
                ...job,
                state: "paused",
                error: undefined,
                errorCode: undefined,
                speedBytesPerSecond: 0,
                etaSeconds: null,
              };
              upsertJob(next);
              await persistJobs();
              broadcast(next);
            }
            sendResponse({ type: "OK" } satisfies ExtensionResponse);
            return;
          }

          case "RESUME_DOWNLOAD": {
            await loadJobs();
            const job =
              jobs.find((j) => j.id === message.jobId) ||
              (typeof message.chromeDownloadId === "number"
                ? findByChromeId(message.chromeDownloadId)
                : undefined);
            if (!job) {
              sendResponse({ type: "OK" } satisfies ExtensionResponse);
              return;
            }

            if (typeof job.chromeDownloadId === "number") {
              await browserApi.downloadsResume(job.chromeDownloadId);
              const next = await refreshJobFromChrome(job);
              await persistJobs();
              broadcast(next);
              sendResponse({ type: "OK" } satisfies ExtensionResponse);
              return;
            }

            // Resume prepare from same stream token (partial files kept).
            const downloadUrl = jobStreamUrls.get(job.id);
            if (job.state === "paused" && downloadUrl) {
              pausedJobIds.delete(job.id);
              const abort = new AbortController();
              jobAbortControllers.set(job.id, abort);
              let next: DownloadJob = {
                ...job,
                state: "preparing",
                error: undefined,
                errorCode: undefined,
              };
              upsertJob(next);
              await persistJobs();
              broadcast(next);

              // Continue asynchronously — respond immediately so UI stays live.
              void (async () => {
                try {
                  await waitUntilMaterialized(
                    downloadUrl,
                    (info) => {
                      next = {
                        ...next,
                        state: "preparing",
                        progress:
                          typeof info.prepareProgress === "number"
                            ? info.prepareProgress
                            : next.progress,
                        totalBytes: info.totalBytes ?? next.totalBytes,
                        estimatedTotalBytes:
                          info.estimatedTotalBytes ??
                          info.totalBytes ??
                          next.estimatedTotalBytes,
                        speedBytesPerSecond: info.speedBytesPerSecond || 0,
                        etaSeconds: info.etaSeconds,
                      };
                      upsertJob(next);
                      void persistJobs();
                      broadcast(next);
                    },
                    abort.signal,
                  );

                  if (abort.signal.aborted) return;

                  const kind = kindFromType(job.type);
                  const baseName = ensureMediaExtension(
                    kind,
                    job.filename.split(/[/\\]/).pop() || job.filename,
                  );
                  next = { ...next, state: "starting" };
                  upsertJob(next);
                  await persistJobs();
                  broadcast(next);

                  const { filename, downloadId } = await startBrowserDownload({
                    downloadUrl,
                    kind,
                    filename: baseName,
                  });
                  next = {
                    ...next,
                    chromeDownloadId: downloadId,
                    filename,
                    state: "starting",
                    bytesReceived: 0,
                  };
                  upsertJob(next);
                  await persistJobs();
                  broadcast(next);
                  next = await refreshJobFromChrome(next);
                  await persistJobs();
                  broadcast(next);
                } catch (e) {
                  const aborted =
                    (e instanceof DOMException && e.name === "AbortError") ||
                    (e instanceof Error && e.name === "AbortError");
                  if (aborted && pausedJobIds.has(job.id)) {
                    next = {
                      ...next,
                      state: "paused",
                      speedBytesPerSecond: 0,
                      etaSeconds: null,
                    };
                    upsertJob(next);
                    await persistJobs();
                    broadcast(next);
                    return;
                  }
                  if (aborted) return;
                  next = {
                    ...next,
                    state: "failed",
                    error:
                      e instanceof Error
                        ? e.message
                        : "Reprise impossible.",
                    completedAt: Date.now(),
                  };
                  upsertJob(next);
                  await persistJobs();
                  broadcast(next);
                } finally {
                  jobAbortControllers.delete(job.id);
                }
              })();

              sendResponse({ type: "OK" } satisfies ExtensionResponse);
              return;
            }

            sendResponse({ type: "OK" } satisfies ExtensionResponse);
            return;
          }

          case "CANCEL_DOWNLOAD": {
            await loadJobs();
            const job =
              jobs.find((j) => j.id === message.jobId) ||
              (typeof message.chromeDownloadId === "number"
                ? findByChromeId(message.chromeDownloadId)
                : undefined);
            if (!job) {
              sendResponse({ type: "OK" } satisfies ExtensionResponse);
              return;
            }

            pausedJobIds.delete(job.id);
            jobAbortControllers.get(job.id)?.abort();
            const url = jobStreamUrls.get(job.id);
            if (url) await cancelServerMaterialize(url);
            jobStreamUrls.delete(job.id);

            if (typeof job.chromeDownloadId === "number") {
              try {
                await browserApi.downloadsCancel(job.chromeDownloadId);
              } catch {
                /* already gone */
              }
            }

            const next: DownloadJob = {
              ...job,
              state: "cancelled",
              error: "Téléchargement annulé.",
              errorCode: "USER_CANCELED",
              completedAt: Date.now(),
              speedBytesPerSecond: 0,
              etaSeconds: null,
            };
            upsertJob(next);
            await persistJobs();
            broadcast(next);
            sendResponse({ type: "OK" } satisfies ExtensionResponse);
            return;
          }

          case "DISMISS_DOWNLOAD": {
            await loadJobs();
            jobs = jobs.filter((j) => j.id !== message.jobId);
            await persistJobs();
            sendResponse({ type: "OK" } satisfies ExtensionResponse);
            return;
          }

          case "OPEN_DOWNLOAD": {
            try {
              await browserApi.downloadsOpen(message.chromeDownloadId);
            } catch (e) {
              console.warn("[DOWNLOAD] open failed, trying show:", e);
              try {
                await browserApi.downloadsShow(message.chromeDownloadId);
              } catch (e2) {
                sendResponse({
                  type: "DOWNLOAD_ERROR",
                  error:
                    e2 instanceof Error
                      ? e2.message
                      : "Impossible d’ouvrir le fichier.",
                } satisfies ExtensionResponse);
                return;
              }
            }
            sendResponse({ type: "OK" } satisfies ExtensionResponse);
            return;
          }

          case "SHOW_DOWNLOAD": {
            try {
              await browserApi.downloadsShow(message.chromeDownloadId);
              sendResponse({ type: "OK" } satisfies ExtensionResponse);
            } catch (e) {
              sendResponse({
                type: "DOWNLOAD_ERROR",
                error:
                  e instanceof Error
                    ? e.message
                    : "Impossible d’afficher le fichier.",
              } satisfies ExtensionResponse);
            }
            return;
          }

          case "SILENT_STREAM_DOWNLOAD": {
            await loadJobs();
            const kind = message.kind;
            const baseName = ensureMediaExtension(kind, message.filename);
            const intendedPath = getDownloadPath(kind, baseName);
            const jobId = createJobId();
            let job: DownloadJob = {
              id: jobId,
              videoId: message.videoId || "site",
              videoUrl: message.videoUrl,
              title: message.title || baseName,
              thumbnail: message.thumbnail,
              type:
                kind === "audio"
                  ? "audio"
                  : kind === "subtitles"
                    ? "subtitle"
                    : "video",
              quality: message.quality,
              filename: intendedPath,
              state: "preparing",
              bytesReceived: 0,
              totalBytes: null,
              progress: 0,
              progressEstimated: false,
              speedBytesPerSecond: 0,
              etaSeconds: null,
              startedAt: Date.now(),
              streamTokenId: extractStreamTokenId(message.downloadUrl),
            };
            upsertJob(job);
            await persistJobs();
            broadcast(job);

            if (kind === "video" || kind === "audio") {
              await waitUntilMaterialized(message.downloadUrl, (info) => {
                job = {
                  ...job,
                  state: "preparing",
                  progress:
                    typeof info.prepareProgress === "number"
                      ? info.prepareProgress
                      : job.progress,
                  totalBytes: info.totalBytes ?? job.totalBytes,
                  estimatedTotalBytes:
                    info.estimatedTotalBytes ??
                    info.totalBytes ??
                    job.estimatedTotalBytes,
                  speedBytesPerSecond: info.speedBytesPerSecond || 0,
                  etaSeconds: info.etaSeconds,
                };
                upsertJob(job);
                void persistJobs();
                broadcast(job);
              });
            }

            job = { ...job, state: "starting" };
            upsertJob(job);
            await persistJobs();
            broadcast(job);

            const { filename, downloadId } = await startBrowserDownload({
              downloadUrl: message.downloadUrl,
              kind,
              filename: baseName,
            });
            job = {
              ...job,
              chromeDownloadId: downloadId,
              filename,
              state: "starting",
              progress: null,
              bytesReceived: 0,
            };
            upsertJob(job);
            await persistJobs();
            broadcast(job);
            job = await refreshJobFromChrome(job);
            await persistJobs();
            broadcast(job);

            sendResponse({
              type: "DOWNLOAD_STARTED",
              jobId: job.id,
              chromeDownloadId: job.chromeDownloadId,
              filename: job.filename,
              job,
            } satisfies ExtensionResponse);
            return;
          }

          case "ANALYZE_GENERIC": {
            try {
              const tabId = sender.tab?.id;
              const embedUrl = message.payload.mediaUrl;
              const fromTab =
                typeof tabId === "number"
                  ? candidateUrlsForAnalyze(tabId, embedUrl)
                  : [embedUrl];
              const fromPayload = Array.isArray(message.payload.candidateUrls)
                ? message.payload.candidateUrls
                : [];
              const candidateUrls = [...fromTab, ...fromPayload].filter(
                (u, i, arr) => u && arr.indexOf(u) === i,
              );

              const data = await analyzeGenericMedia({
                mediaUrl: embedUrl,
                pageUrl: message.payload.pageUrl,
                title: message.payload.title,
                candidateUrls,
              });
              sendResponse({
                type: "ANALYZE_GENERIC_SUCCESS",
                data,
              } satisfies ExtensionResponse);
            } catch (e) {
              sendResponse({
                type: "ANALYZE_GENERIC_ERROR",
                error:
                  e instanceof Error
                    ? e.message
                    : "Source vidéo non prise en charge.",
              } satisfies ExtensionResponse);
            }
            return;
          }

          case "START_GENERIC_DOWNLOAD": {
            await loadJobs();
            const p = message.payload;
            const kind = p.downloadType === "audio" ? "audio" : "video";
            const jobId = createJobId();
            const videoId = `web:${jobId.slice(0, 8)}`;
            let job: DownloadJob = {
              id: jobId,
              videoId,
              videoUrl: p.pageUrl,
              title: p.title || "Web video",
              type: kind === "audio" ? "audio" : "video",
              quality: p.quality,
              format: p.container,
              filename: p.filename,
              state: "preparing",
              bytesReceived: 0,
              totalBytes: null,
              progress: 0,
              progressEstimated: false,
              speedBytesPerSecond: 0,
              etaSeconds: null,
              startedAt: Date.now(),
              resolution:
                typeof p.height === "number" ? `${p.height}p` : undefined,
              formatId: p.formatId,
            };
            upsertJob(job);
            await persistJobs();
            broadcast(job);

            sendResponse({
              type: "DOWNLOAD_STARTED",
              jobId: job.id,
              filename: job.filename,
              job,
            } satisfies ExtensionResponse);

            void (async () => {
              try {
                const prepared = await prepareGenericMedia({
                  mediaUrl: p.mediaUrl,
                  type: kind === "audio" ? "audio" : "video",
                  title: p.title,
                  pageUrl: p.pageUrl,
                  quality: p.quality,
                  preferYtDlp: p.preferYtDlp,
                  formatId: p.formatId,
                  audioFormatId: p.audioFormatId,
                  height: p.height,
                });
                const baseName = ensureMediaExtension(
                  kind === "audio" ? "audio" : "video",
                  prepared.filename || p.filename,
                );
                job = {
                  ...job,
                  state: "starting",
                  streamTokenId: extractStreamTokenId(prepared.downloadUrl),
                  filename: getDownloadPath(
                    kind === "audio" ? "audio" : "video",
                    baseName,
                  ),
                };
                upsertJob(job);
                await persistJobs();
                broadcast(job);

                const { filename, downloadId } = await startBrowserDownload({
                  downloadUrl: prepared.downloadUrl,
                  kind: kind === "audio" ? "audio" : "video",
                  filename: baseName,
                });
                job = {
                  ...job,
                  chromeDownloadId: downloadId,
                  filename,
                  state: "starting",
                  bytesReceived: 0,
                };
                upsertJob(job);
                await persistJobs();
                broadcast(job);
                job = await refreshJobFromChrome(job);
                await persistJobs();
                broadcast(job);
              } catch (e) {
                job = {
                  ...job,
                  state: "failed",
                  error:
                    e instanceof Error
                      ? e.message
                      : "Cette vidéo ne peut pas être téléchargée.",
                  errorCode: "GENERIC_PREPARE_FAILED",
                  completedAt: Date.now(),
                };
                upsertJob(job);
                await persistJobs();
                broadcast(job);
              }
            })();
            return;
          }

          case "START_DOWNLOAD": {
            const payload = message.payload;
            const snapshot = createDownloadSnapshot({
              videoId: payload.videoId,
              videoUrl: payload.videoUrl,
              title: payload.title,
              channel: payload.channel,
              thumbnail: payload.thumbnail,
              downloadType: payload.type,
              quality: payload.quality,
              formatId: payload.formatId,
              audioFormatId: payload.audioFormatId,
              bitrate: payload.bitrate,
              language: payload.language,
              targetLanguage: payload.targetLanguage,
              resolution: payload.resolution,
              fps: payload.fps,
              container: payload.container,
              codec: payload.codec,
              estimatedSize: payload.estimatedSize ?? null,
              filename: payload.filename,
              jobId: payload.jobId,
              createdAt: payload.createdAt,
            });
            // Respond immediately so Active + badge update without waiting
            // for prepare/materialize to finish.
            await loadJobs();
            const early = snapshotToJob(snapshot);
            upsertJob(early);
            await persistJobs();
            broadcast(early);
            sendResponse({
              type: "DOWNLOAD_STARTED",
              jobId: early.id,
              filename: early.filename,
              job: early,
            } satisfies ExtensionResponse);

            void startFromSnapshot(snapshot).catch((e) => {
              debugLog("startFromSnapshot failed", e);
            });
            return;
          }

          case "DOWNLOAD_VIDEO":
          case "DOWNLOAD_AUDIO":
          case "DOWNLOAD_SUBTITLE": {
            const snapshot = createDownloadSnapshot(
              legacyMessageToPayload(message),
            );
            await loadJobs();
            const early = snapshotToJob(snapshot);
            upsertJob(early);
            await persistJobs();
            broadcast(early);
            sendResponse({
              type: "DOWNLOAD_STARTED",
              jobId: early.id,
              filename: early.filename,
              job: early,
            } satisfies ExtensionResponse);
            void startFromSnapshot(snapshot).catch((e) => {
              debugLog("startFromSnapshot failed", e);
            });
            return;
          }

          default:
            sendResponse({ type: "OK" } satisfies ExtensionResponse);
        }
      } catch (e) {
        debugLog("message error", e);
        console.error("[DOWNLOAD] error", e);
        const raw = e instanceof Error ? e.message : String(e);
        const offline =
          raw.includes("Failed to fetch") ||
          raw.includes("NetworkError") ||
          raw.includes("contacter");
        const error = offline
          ? "Impossible de contacter NovaDownloader."
          : raw.includes("download URL") || raw.includes("joindre")
            ? "NovaDownloader n’arrive pas à joindre le serveur de téléchargement."
            : raw.includes("expiré") || raw.includes("expired")
              ? "Le lien de téléchargement a expiré. Réessayez."
              : raw || "Le téléchargement n’a pas pu être préparé.";
        sendResponse({
          type: "DOWNLOAD_ERROR",
          error,
        } satisfies ExtensionResponse);
      }
    })();
    return true;
  },
);

setInterval(() => clearCachedAnalysis(), 15 * 60 * 1000);

void loadJobs().then(() => updateBadge());

debugLog("service worker ready");
console.log("[DOWNLOAD] service worker ready");
