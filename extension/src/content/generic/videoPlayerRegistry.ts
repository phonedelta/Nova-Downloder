import {
  analyzeVideoElement,
  type DetectedWebVideo,
} from "./webVideoDetector";

export type RegisteredPlayer = {
  id: string;
  video: HTMLVideoElement;
  info: DetectedWebVideo;
  uiRoot: HTMLElement | null;
};

const ATTR = "data-nova-downloader";

/** Videos already processed (WeakSet avoids leaks). */
const seen = new WeakSet<HTMLVideoElement>();
const registry = new Map<string, RegisteredPlayer>();
let seq = 0;

export function getRegistry(): ReadonlyMap<string, RegisteredPlayer> {
  return registry;
}

export function markProcessed(video: HTMLVideoElement): boolean {
  if (seen.has(video)) return false;
  if (video.getAttribute(ATTR) === "true") return false;
  seen.add(video);
  video.setAttribute(ATTR, "true");
  return true;
}

export function registerVideo(
  video: HTMLVideoElement,
  uiRoot: HTMLElement | null,
): RegisteredPlayer | null {
  if (!markProcessed(video)) return null;
  const id = `nova-web-${++seq}`;
  const info = analyzeVideoElement(video);
  const entry: RegisteredPlayer = { id, video, info, uiRoot };
  registry.set(id, entry);
  return entry;
}

export function unregisterByVideo(video: HTMLVideoElement): void {
  for (const [id, entry] of registry) {
    if (entry.video === video) {
      entry.uiRoot?.remove();
      registry.delete(id);
      video.removeAttribute(ATTR);
      return;
    }
  }
}

export function refreshInfo(id: string): DetectedWebVideo | null {
  const entry = registry.get(id);
  if (!entry) return null;
  entry.info = analyzeVideoElement(entry.video);
  return entry.info;
}

export function findUnprocessedVideos(root: ParentNode = document): HTMLVideoElement[] {
  const list = Array.from(root.querySelectorAll("video"));
  return list.filter(
    (v) => !seen.has(v) && v.getAttribute(ATTR) !== "true",
  );
}
