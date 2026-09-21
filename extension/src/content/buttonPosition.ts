import { browserApi } from "../utils/browserApi";
import { HOST_ID, OVERLAY_ID } from "./injectButton";

const STORAGE_KEY = "nova_btn_pos_v2";

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
  if (host) resetHostPosition(host);
}

export function resetHostPosition(host: HTMLElement): void {
  host.style.left = "";
  host.style.top = "";
  host.style.right = "";
  host.dataset.dragged = "false";
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

function overlayRect(): DOMRect | null {
  const overlay = document.getElementById(OVERLAY_ID);
  return overlay?.getBoundingClientRect() ?? null;
}

/** Clamp host top-left so the button stays inside the player overlay. */
export function clampPos(
  left: number,
  top: number,
  hostW: number,
  hostH: number,
): ButtonPos {
  const box = overlayRect();
  if (!box) return { left: Math.max(0, left), top: Math.max(0, top) };
  const maxL = Math.max(0, box.width - hostW - 4);
  const maxT = Math.max(0, box.height - hostH - 4);
  return {
    left: Math.min(maxL, Math.max(4, left)),
    top: Math.min(maxT, Math.max(4, top)),
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
  const box = overlayRect();
  if (!box) {
    return clampPos(clientX - offsetX, clientY - offsetY, hostW, hostH);
  }
  return clampPos(
    clientX - box.left - offsetX,
    clientY - box.top - offsetY,
    hostW,
    hostH,
  );
}
