import cssText from "../styles/extension.css?inline";
import { HOST_ID } from "./injectButton";

export const PANEL_LAYER_ID = "novadownloader-panel-layer";

/**
 * Floating layer on document.body so the panel is never clipped by
 * YouTube's player overflow:hidden — while we still anchor it to the button.
 */
export function ensurePanelLayer(): HTMLElement {
  let host = document.getElementById(PANEL_LAYER_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = PANEL_LAYER_ID;
    host.setAttribute("data-novadownloader-panel-layer", "true");
    host.style.cssText =
      "position:fixed;inset:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:2147483646;";
    document.documentElement.appendChild(host);
  }

  const shadow =
    host.shadowRoot || host.attachShadow({ mode: "open" });
  if (!shadow.querySelector("style[data-nova-panel-css]")) {
    shadow.innerHTML = "";
    const style = document.createElement("style");
    style.setAttribute("data-nova-panel-css", "true");
    style.textContent = cssText;
    const mount = document.createElement("div");
    mount.id = "nova-panel-portal-root";
    mount.style.cssText = "pointer-events:none;";
    shadow.append(style, mount);
  }

  const mount = shadow.getElementById("nova-panel-portal-root");
  if (!mount) {
    const el = document.createElement("div");
    el.id = "nova-panel-portal-root";
    el.style.cssText = "pointer-events:none;";
    shadow.appendChild(el);
    return el;
  }
  return mount;
}

export function removePanelLayer(): void {
  document.getElementById(PANEL_LAYER_ID)?.remove();
}

/** Place panel on the opposite side of the Nova button (avoids covering it). */
export function getPanelAnchor(): {
  top: number;
  right: number;
  maxHeight: number;
} {
  const host = document.getElementById(HOST_ID);
  const rect = host?.getBoundingClientRect();
  const panelWidth = 360;
  const margin = 16;

  if (!rect || rect.width === 0) {
    return {
      top: 72,
      right: margin,
      maxHeight: Math.max(240, window.innerHeight - 88),
    };
  }

  const top = Math.round(Math.min(
    rect.bottom + 10,
    Math.max(margin, window.innerHeight - 240),
  ));
  const buttonCenterX = rect.left + rect.width / 2;
  const buttonOnLeft = buttonCenterX < window.innerWidth / 2;

  // Button left → panel right; button right → panel left
  const right = buttonOnLeft
    ? margin
    : Math.max(margin, Math.round(window.innerWidth - panelWidth - margin));

  const maxHeight = Math.max(240, Math.floor(window.innerHeight - top - margin));
  return { top, right, maxHeight };
}
