import { startBrowserDownload } from "../services/downloadFile";
import { useState, useRef, useEffect, useCallback } from "react";
import { request } from "../services/api";
import type { Recent } from "../types";

type ActiveWebDownload = {
  jobId: string;
  title: string;
  state: string;
  bytesSent: number;
  totalBytes: number | null;
  totalBytesExact: boolean;
  estimatedTotalBytes: number | null;
  progress: number | null;
  speedBytesPerSecond: number;
  etaSeconds: number | null;
};

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
    for (const job of current) {
      try {
        const s = await request<{
          jobId: string;
          state: string;
          bytesSent: number;
          totalBytes: number | null;
          totalBytesExact: boolean;
          estimatedTotalBytes: number | null;
          speedBytesPerSecond: number;
          etaSeconds: number | null;
        }>(`/download/status/${encodeURIComponent(job.jobId)}`);
        const progress =
          s.totalBytesExact &&
          typeof s.totalBytes === "number" &&
          s.totalBytes > 0
            ? Math.min(100, Math.max(0, (s.bytesSent / s.totalBytes) * 100))
            : null;
        next.push({
          jobId: s.jobId,
          title: job.title,
          state: s.state,
          bytesSent: s.bytesSent,
          totalBytes: s.totalBytes,
          totalBytesExact: s.totalBytesExact,
          estimatedTotalBytes: s.estimatedTotalBytes,
          progress,
          speedBytesPerSecond: s.speedBytesPerSecond,
          etaSeconds: s.etaSeconds,
        });
      } catch {
        next.push(job);
      }
    }
    setActive(
      next.filter((j) => j.state !== "completed" && j.state !== "failed"),
    );
  }, []);

  useEffect(() => {
    if (!active.length) return;
    const id = window.setInterval(() => void pollStatus(), 1000);
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

  async function download(
    path: string,
    body: unknown,
    item: Omit<Recent, "date">,
  ) {
    setPreparing(true);
    setError("");
    setStatus("Préparation…");

    try {
      const kind =
        path.includes("audio")
          ? "audio"
          : path.includes("subtitle")
            ? "subtitles"
            : "video";
      const prepared = await request<{
        downloadUrl: string;
        filename: string;
      }>("/download/prepare", {
        ...(body as object),
        type: kind,
      });
      await startBrowserDownload({
        downloadUrl: prepared.downloadUrl,
        filename: prepared.filename,
        kind,
        title: item.title,
        quality: item.format,
      });
      const tokenMatch = prepared.downloadUrl.match(
        /\/download\/stream\/([^/?#]+)/,
      );
      if (tokenMatch?.[1]) {
        setActive((prev) => [
          {
            jobId: tokenMatch[1],
            title: item.title,
            state: "downloading",
            bytesSent: 0,
            totalBytes: null,
            totalBytesExact: false,
            estimatedTotalBytes: null,
            progress: null,
            speedBytesPerSecond: 0,
            etaSeconds: null,
          },
          ...prev,
        ]);
      }
      setStatus("Téléchargement lancé — vous pouvez fermer cette page.");
      const next = [
        { ...item, date: new Date().toISOString() },
        ...recent,
      ].slice(0, 8);
      setRecent(next);
      try {
        localStorage.setItem("nova-history", JSON.stringify(next));
      } catch {}
    } catch {
      setError("Le téléchargement n’a pas pu être préparé. Réessayez.");
      setStatus("");
    } finally {
      setPreparing(false);
    }
  }
  return {
    // Keep `busy` for prepare feedback only — does not block other starts
    busy: preparing,
    status,
    error,
    recent,
    active,
    download,
  };
}
