import genericCss from "./genericVideo.css?inline";

const STYLE_ID = "nova-generic-video-style";

export function ensureGenericStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = genericCss;
  document.documentElement.appendChild(style);
}

/**
 * Keep overlay pinned to the player's visible box (fixed).
 * Avoids parent overflow/stacking issues common on embed aggregators.
 */
function trackAnchorPosition(anchor: HTMLElement, wrap: HTMLElement): () => void {
  const place = () => {
    if (!document.contains(anchor) || !document.contains(wrap)) return;
    const r = anchor.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) {
      wrap.style.visibility = "hidden";
      return;
    }
    wrap.style.visibility = "visible";
    wrap.style.position = "fixed";
    wrap.style.top = `${Math.max(8, r.top + 10)}px`;
    wrap.style.left = "auto";
    wrap.style.right = `${Math.max(8, window.innerWidth - r.right + 10)}px`;
    wrap.style.zIndex = "2147483000";
  };

  place();
  const ro =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => place())
      : null;
  ro?.observe(anchor);
  window.addEventListener("scroll", place, true);
  window.addEventListener("resize", place);
  const iv = window.setInterval(place, 1000);

  return () => {
    ro?.disconnect();
    window.removeEventListener("scroll", place, true);
    window.removeEventListener("resize", place);
    window.clearInterval(iv);
  };
}

export function createPlayerOverlay(
  anchor: HTMLElement,
): {
  wrap: HTMLElement;
  btn: HTMLButtonElement;
  dispose?: () => void;
} {
  ensureGenericStyles();

  const wrap = document.createElement("div");
  wrap.className = "nova-generic-wrap nova-generic-wrap--fixed";
  wrap.setAttribute("data-nova-generic-ui", "true");

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "nova-generic-btn";
  btn.setAttribute("aria-label", "NovaDownloader");
  btn.innerHTML = `<span class="nova-generic-btn-icon" aria-hidden="true">↓</span><span>Nova</span>`;

  // Don't steal player gestures
  const stop = (e: Event) => {
    e.stopPropagation();
  };
  btn.addEventListener("pointerdown", stop);
  btn.addEventListener("mousedown", stop);
  btn.addEventListener("click", stop);

  wrap.appendChild(btn);
  document.documentElement.appendChild(wrap);

  const disposeTrack = trackAnchorPosition(anchor, wrap);

  return {
    wrap,
    btn,
    dispose: () => {
      disposeTrack();
      wrap.remove();
    },
  };
}
