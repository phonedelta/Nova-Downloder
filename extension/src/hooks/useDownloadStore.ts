import { useCallback, useEffect, useRef, useState } from "react";
import type { DownloadJob } from "@nova/shared";
import { isActiveDownloadState } from "@nova/shared";
import { browserApi } from "../utils/browserApi";
import type { ExtensionResponse } from "../types/api";

const POLL_MS = 900;

/**
 * Download store mirror for the panel UI.
 * Source of truth remains the service worker + chrome.storage.local.
 * Never tied to the current YouTube page videoId.
 * Single poller (~1s) while any job is active — stops when idle.
 */
export function useDownloadStore(onActiveCountChange?: (n: number) => void) {
  const [downloads, setDownloads] = useState<DownloadJob[]>([]);
  const mounted = useRef(true);

  const mergeJob = useCallback((job: DownloadJob) => {
    setDownloads((prev) => {
      const idx = prev.findIndex((j) => j.id === job.id);
      if (idx < 0) return [job, ...prev];
      const next = [...prev];
      next[idx] = job;
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = (await browserApi.sendMessage({
        type: "GET_DOWNLOADS",
      })) as ExtensionResponse;
      if (!mounted.current) return;
      if (response.type === "DOWNLOADS") {
        setDownloads(response.downloads);
        onActiveCountChange?.(response.activeCount);
      }
    } catch {
      /* SW asleep */
    }
  }, [onActiveCountChange]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  const hasActive = downloads.some((j) => isActiveDownloadState(j.state));

  useEffect(() => {
    if (!hasActive) return;
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [hasActive, refresh]);

  useEffect(() => {
    const onMessage = (message: ExtensionResponse) => {
      if (message.type === "DOWNLOAD_UPDATED" && message.job) {
        mergeJob(message.job);
      }
    };
    try {
      browserApi.runtime.onMessage.addListener(onMessage as never);
    } catch {
      /* */
    }

    const onStorage = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== "local") return;
      const ping = changes.nova_dl_broadcast?.newValue as
        | { job?: DownloadJob }
        | undefined;
      if (ping?.job) mergeJob(ping.job);
    };
    try {
      browserApi.storage.onChanged.addListener(onStorage);
    } catch {
      /* */
    }

    return () => {
      try {
        browserApi.runtime.onMessage.removeListener(onMessage as never);
      } catch {
        /* */
      }
      try {
        browserApi.storage.onChanged.removeListener(onStorage);
      } catch {
        /* */
      }
    };
  }, [mergeJob]);

  useEffect(() => {
    const n = downloads.filter((j) => isActiveDownloadState(j.state)).length;
    onActiveCountChange?.(n);
  }, [downloads, onActiveCountChange]);

  const removeLocal = useCallback((jobId: string) => {
    setDownloads((prev) => prev.filter((j) => j.id !== jobId));
  }, []);

  return {
    downloads,
    mergeJob,
    refresh,
    removeLocal,
    activeCount: downloads.filter((j) => isActiveDownloadState(j.state)).length,
  };
}
