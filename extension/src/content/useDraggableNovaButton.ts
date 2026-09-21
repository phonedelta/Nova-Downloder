import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { HOST_ID } from "./injectButton";
import {
  applyButtonPos,
  clearButtonPos,
  clientToOverlayPos,
  saveButtonPos,
  type ButtonPos,
} from "./buttonPosition";

const DRAG_THRESHOLD = 6;
const DBLCLICK_MS = 320;

/**
 * Drag the floating Nova host inside the player.
 * Distinguishes click vs drag; double-click resets to default position.
 */
export function useDraggableNovaButton(onOpen: () => void) {
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    moved: boolean;
    hostW: number;
    hostH: number;
  } | null>(null);
  const lastTapRef = useRef(0);
  const openTimerRef = useRef<number | null>(null);

  const cancelPendingOpen = () => {
    if (openTimerRef.current != null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  };

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest(".nova-btn-dismiss")) return;

    const host = document.getElementById(HOST_ID);
    if (!host) return;

    e.stopPropagation();

    const rect = host.getBoundingClientRect();
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      moved: false,
      hostW: rect.width,
      hostH: rect.height,
    };

    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* */
    }
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    cancelPendingOpen();
    e.preventDefault();
    e.stopPropagation();

    const host = document.getElementById(HOST_ID);
    if (!host) return;

    const pos: ButtonPos = clientToOverlayPos(
      e.clientX,
      e.clientY,
      drag.offsetX,
      drag.offsetY,
      drag.hostW,
      drag.hostH,
    );
    applyButtonPos(host, pos);
    host.classList.add("nova-host-dragging");
  }, []);

  const endDrag = useCallback(
    (e: ReactPointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      dragRef.current = null;

      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* */
      }

      const host = document.getElementById(HOST_ID);
      host?.classList.remove("nova-host-dragging");
      e.stopPropagation();

      if (drag.moved) {
        e.preventDefault();
        if (host) {
          const left = parseFloat(host.style.left || "0");
          const top = parseFloat(host.style.top || "0");
          void saveButtonPos({ left, top });
        }
        return;
      }

      // Double-click → reset position (cancel pending open)
      const now = Date.now();
      if (now - lastTapRef.current < DBLCLICK_MS) {
        lastTapRef.current = 0;
        cancelPendingOpen();
        void clearButtonPos();
        return;
      }
      lastTapRef.current = now;
      cancelPendingOpen();
      openTimerRef.current = window.setTimeout(() => {
        openTimerRef.current = null;
        onOpen();
      }, DBLCLICK_MS);
    },
    [onOpen],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  };
}
