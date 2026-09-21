import { browserApi } from "../utils/browserApi";
import { findYouTubePlayerContainer } from "../utils/youtubeSelectors";
import { HOST_ID, placeHostDefault } from "./injectButton";

const STORAGE_KEY = "nova_btn_pos_v3";

export type ButtonPos = { left: number; top: number };

export async function loadButtonPos(): Promise<ButtonPos | null> {
  try {
    const data = await browserApi.storageLocalGet<{
      [STORAGE_KEY]?: ButtonPos | null;
    }>({ [STORAGE_KEY]: null });
    const raw = data[STORAGE_KEY];
    if (
      raw &&
      typeof raw.left === "number" &&
      typeof raw.top === "number" &&
      Number.isFinite(raw.left) &&
      Number.isFinite(raw.top)
    ) {
      return { left: raw.left, top: raw.top };
    }
  } catch {
    /* */
  }
  return null;
}

export async function saveButtonPos(pos: ButtonPos): Promise<void> {
  try {
    await browserApi.storageLocalSet({ [STORAGE_KEY]: pos });
  } catch {
    /* */
  }
}

export async function clearButtonPos(): Promise<void> {
  try {
    await browserApi.storageLocalSet({ [STORAGE_KEY]: null });
  } catch {
    /* */
  }
  const host = document.getElementById(HOST_ID);
  if (host) {
    host.dataset.dragged = "false";
    placeHostDefault(host);
  }
}

export function resetHostPosition(host: HTMLElement): void {
  host.dataset.dragged = "false";
  placeHostDefault(host);
}

export function applyButtonPos(host: HTMLElement, pos: ButtonPos | null): void {
  if (!pos) {
    resetHostPosition(host);
    return;
  }
  host.style.left = `${Math.round(pos.left)}px`;
  host.style.top = `${Math.round(pos.top)}px`;
  host.style.right = "auto";
  host.dataset.dragged = "true";
}

function playerRect(): DOMRect | null {
  return findYouTubePlayerContainer()?.getBoundingClientRect() ?? null;
}

/** Clamp viewport left/top so the button stays over the player. */
export function clampPos(
  left: number,
  top: number,
  hostW: number,
  hostH: number,
): ButtonPos {
  const box = playerRect();
  if (!box) {
    return {
      left: Math.max(4, Math.min(left, window.innerWidth - hostW - 4)),
      top: Math.max(4, Math.min(top, window.innerHeight - hostH - 4)),
    };
  }
  const maxL = Math.max(box.left, box.right - hostW - 4);
  const maxT = Math.max(box.top, box.bottom - hostH - 4);
  return {
    left: Math.min(maxL, Math.max(box.left + 4, left)),
    top: Math.min(maxT, Math.max(box.top + 4, top)),
  };
}

export function clientToOverlayPos(
  clientX: number,
  clientY: number,
  offsetX: number,
  offsetY: number,
  hostW: number,
  hostH: number,
): ButtonPos {
  return clampPos(clientX - offsetX, clientY - offsetY, hostW, hostH);
}
