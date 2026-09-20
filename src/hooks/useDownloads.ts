import {
  startBrowserDownload,
  resolveDownloadUrl,
} from "../services/downloadFile";
import { useState, useRef, useEffect, useCallback } from "react";
import { request } from "../services/api";
import type { Recent } from "../types";

export type ActiveWebDownload = {
  jobId: string;
  title: string;
  thumbnail?: string;
  quality?: string;
  kind: "video" | "audio" | "subtitles";
  state: string;
  bytesSent: number;
  totalBytes: number | null;
  totalBytesExact: boolean;
  estimatedTotalBytes: number | null;
  progress: number | null;
  speedBytesPerSecond: number;
  etaSeconds: number | null;
  error?: string;
  completedAt?: number;
};

async function waitUntilMaterializedWeb(
  downloadUrl: string,
  onProgress?: (info: {
    prepareProgress: number | null;
    totalBytes: number | null;
    estimatedTotalBytes: number | null;
    speedBytesPerSecond: number;
    etaSeconds: number | null;
    state: string;
    bytesSent?: number;
  }) => void,
): Promise<void> {
  const url = resolveDownloadUrl(downloadUrl);
  let parsed: URL;
  try {
    parsed = new URL(url, window.location.origin);
  } catch {
    return;
  }
  const id = parsed.pathname.match(/\/download\/stream\/([^/?#]+)/)?.[1];
  const sig = parsed.searchParams.get("sig") || "";
  if (!id) return;

  await fetch(
    `/api/download/materialize/${encodeURIComponent(id)}?sig=${encodeURIComponent(sig)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  ).catch(() => {
    /* GET stream can still build */
  });

  const started = Date.now();
  while (Date.now() - started < 15 * 60 * 1000) {
    try {
      const s = await request<{
        state: string;
        prepareProgress?: number | null;
        totalBytes?: number | null;
        estimatedTotalBytes?: number | null;
        speedBytesPerSecond?: number;
        etaSeconds?: number | null;
        bytesSent?: number;
        error?: string | { message?: string } | null;
      }>(`/download/status/${encodeURIComponent(id)}`);
      onProgress?.({
        prepareProgress:
          typeof s.prepareProgress === "number" ? s.prepareProgress : null,
        totalBytes: s.totalBytes ?? null,
        estimatedTotalBytes: s.estimatedTotalBytes ?? null,
        speedBytesPerSecond: s.speedBytesPerSecond || 0,
        etaSeconds: s.etaSeconds ?? null,
        state: s.state,
        bytesSent: s.bytesSent,
      });
      if (s.state === "ready" || s.state === "streaming" || s.state === "done") {
        return;
      }
      if (s.state === "failed" || s.state === "cancelled") {
        const msg =
          typeof s.error === "string"
            ? s.error
            : s.error?.message || "Préparation impossible.";
        throw new Error(msg);
      }
    } catch (e) {
      if (e instanceof Error && /Préparation|impossible|Échec/i.test(e.message))
        throw e;
    }
    await new Promise((r) => setTimeout(r, 800));
  }
}

export function useDownloads() {
  const [preparing, setPreparing] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [active, setActive] = useState<ActiveWebDownload[]>([]);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (!preparing && (status || error)) {
      const timer = setTimeout(() => {
        setStatus("");
        setError("");
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [preparing, status, error]);

  const pollStatus = useCallback(async () => {
    const current = activeRef.current;
    if (!current.length) return;
    const next: ActiveWebDownload[] = [];
    const now = Date.now();

    for (const job of current) {
      if (job.state === "completed" || job.state === "failed") {
        // Keep finished cards ~8s then drop
        if (job.completedAt && now - job.completedAt > 8000) continue;
        next.push(job);
        continue;
      }

      try {
        const s = await request<{
          jobId: string;
          state: string;
          bytesSent: number;
          totalBytes: number | null;
          totalBytesExact: boolean;
          estimatedTotalBytes: number | null;
          prepareProgress: number | null;
          speedBytesPerSecond: number;
          etaSeconds: number | null;
          error: { code: string; message: string } | null;
        }>(`/download/status/${encodeURIComponent(job.jobId)}`);

        let progress: number | null = null;
        if (
          s.state === "preparing" ||
          s.state === "ready" ||
          s.state === "paused"
        ) {
          progress =
            typeof s.prepareProgress === "number" ? s.prepareProgress : job.progress;
        } else if (
          s.totalBytesExact &&
          typeof s.totalBytes === "number" &&
          s.totalBytes > 0
        ) {
          progress = Math.min(
            100,
            Math.max(0, (s.bytesSent / s.totalBytes) * 100),
          );
        } else if (typeof s.prepareProgress === "number") {
          progress = s.prepareProgress;
        } else {
          progress = job.progress;
        }

        let state = s.state;
        if (s.state === "ready" && job.state === "downloading") {
          state = "downloading";
        }
        if (s.state === "done" || s.state === "streaming") {
          // During browser transfer, status may be streaming/done
          if (s.state === "done" || (s.bytesSent > 0 && s.totalBytesExact && s.bytesSent >= (s.totalBytes || 0))) {
            state = s.state === "done" ? "completed" : "downloading";
          } else {
            state = "downloading";
          }
        }
        if (s.state === "failed") state = "failed";

        const updated: ActiveWebDownload = {
          ...job,
          state,
          bytesSent: s.bytesSent ?? job.bytesSent,
          totalBytes: s.totalBytes,
          totalBytesExact: s.totalBytesExact,
          estimatedTotalBytes: s.estimatedTotalBytes,
          progress: state === "completed" ? 100 : progress,
          speedBytesPerSecond: s.speedBytesPerSecond || 0,
          etaSeconds: s.etaSeconds,
          error: s.error?.message,
          completedAt:
            state === "completed" || state === "failed"
              ? job.completedAt || now
              : undefined,
        };
        next.push(updated);
      } catch {
        next.push(job);
      }
    }
    setActive(next);
  }, []);

  useEffect(() => {
    if (!active.length) return;
    const id = window.setInterval(() => void pollStatus(), 800);
    return () => window.clearInterval(id);
  }, [active.length, pollStatus]);

  const [recent, setRecent] = useState<Recent[]>(() => {
    try {
      const value = JSON.parse(localStorage.getItem("nova-history") || "[]");
      return Array.isArray(value)
        ? value
            .filter(
              (x) =>
                typeof x.title === "string" && typeof x.format === "string",
            )
            .slice(0, 8)
        : [];
    } catch {
      return [];
    }
  });

  function dismiss(jobId: string) {
    setActive((prev) => prev.filter((j) => j.jobId !== jobId));
  }

  async function download(
    path: string,
    body: unknown,
    item: Omit<Recent, "date">,
  ) {
    setPreparing(true);
    setError("");
    setStatus("Préparation…");

    const kind: ActiveWebDownload["kind"] = path.includes("audio")
      ? "audio"
      : path.includes("subtitle")
        ? "subtitles"
        : "video";

    try {
      const prepared = await request<{
        downloadUrl: string;
        filename: string;
      }>("/download/prepare", {
        ...(body as object),
        type: kind === "subtitles" ? "subtitles" : kind,
      });
      const downloadUrl = resolveDownloadUrl(prepared.downloadUrl);
      const tokenMatch = downloadUrl.match(/\/download\/stream\/([^/?#]+)/);
      const jobId = tokenMatch?.[1];

      if (jobId && (kind === "video" || kind === "audio")) {
        setActive((prev) => [
          {
            jobId,
            title: item.title,
            thumbnail: item.thumbnail,
            quality: item.format,
            kind,
            state: "preparing",
            bytesSent: 0,
            totalBytes: null,
            totalBytesExact: false,
            estimatedTotalBytes: null,
            progress: 0,
            speedBytesPerSecond: 0,
            etaSeconds: null,
          },
          ...prev.filter((j) => j.jobId !== jobId),
        ]);
        setStatus("Préparation du fichier…");
        await waitUntilMaterializedWeb(downloadUrl, (info) => {
          setActive((prev) =>
            prev.map((j) =>
              j.jobId === jobId
                ? {
                    ...j,
                    state: info.state === "ready" ? "starting" : "preparing",
                    progress: info.prepareProgress,
                    totalBytes: info.totalBytes,
                    estimatedTotalBytes: info.estimatedTotalBytes,
                    speedBytesPerSecond: info.speedBytesPerSecond,
                    etaSeconds: info.etaSeconds,
                    bytesSent: info.bytesSent ?? j.bytesSent,
                  }
                : j,
            ),
          );
        });
      } else if (jobId) {
        setActive((prev) => [
          {
            jobId,
            title: item.title,
            thumbnail: item.thumbnail,
            quality: item.format,
            kind,
            state: "downloading",
            bytesSent: 0,
            totalBytes: null,
            totalBytesExact: false,
            estimatedTotalBytes: null,
            progress: null,
            speedBytesPerSecond: 0,
            etaSeconds: null,
          },
          ...prev.filter((j) => j.jobId !== jobId),
        ]);
      }

      await startBrowserDownload({
        downloadUrl,
        filename: prepared.filename,
        kind,
        title: item.title,
        quality: item.format,
      });

      if (jobId) {
        setActive((prev) =>
          prev.map((j) =>
            j.jobId === jobId
              ? { ...j, state: "downloading", progress: j.progress ?? 0 }
              : j,
          ),
        );
      }
      setStatus("Téléchargement lancé — vous pouvez fermer cette page.");
      const next = [
        { ...item, date: new Date().toISOString() },
        ...recent,
      ].slice(0, 8);
      setRecent(next);
      try {
        localStorage.setItem("nova-history", JSON.stringify(next));
      } catch {
        /* */
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Le téléchargement n’a pas pu être préparé. Réessayez.",
      );
      setStatus("");
      setActive((prev) =>
        prev.map((j) =>
          j.state === "preparing" || j.state === "starting"
            ? {
                ...j,
                state: "failed",
                error:
                  e instanceof Error
                    ? e.message
                    : "Le téléchargement n’a pas pu être préparé.",
                completedAt: Date.now(),
              }
            : j,
        ),
      );
    } finally {
      setPreparing(false);
    }
  }

  function clear() {
    setRecent([]);
    try {
      localStorage.removeItem("nova-history");
    } catch {
      /* */
    }
  }

  return {
    busy: preparing,
    status,
    error,
    recent,
    active,
    download,
    clear,
    dismiss,
  };
}
