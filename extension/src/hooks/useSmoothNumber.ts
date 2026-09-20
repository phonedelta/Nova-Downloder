import { useEffect, useRef, useState } from "react";

/**
 * Interpolate toward each new target over ~durationMs so values tick
 * evenly (10→11→12→13→14→15 across ~1s) instead of rushing then pausing.
 */
export function useSmoothNumber(
  target: number | null | undefined,
  opts?: { durationMs?: number; decimals?: number },
): number | null {
  const durationMs = opts?.durationMs ?? 1000;
  const decimals = opts?.decimals ?? 0;

  const [display, setDisplay] = useState<number | null>(
    typeof target === "number" && Number.isFinite(target) ? target : null,
  );

  const displayRef = useRef(display);
  const fromRef = useRef<number | null>(display);
  const toRef = useRef<number | null>(
    typeof target === "number" && Number.isFinite(target) ? target : null,
  );
  const startRef = useRef<number>(performance.now());

  displayRef.current = display;

  // When the real target changes, start a fresh lerp from the current display.
  useEffect(() => {
    if (typeof target !== "number" || !Number.isFinite(target)) {
      fromRef.current = null;
      toRef.current = null;
      setDisplay(null);
      return;
    }

    const from =
      displayRef.current != null && Number.isFinite(displayRef.current)
        ? displayRef.current
        : target;
    fromRef.current = from;
    toRef.current = target;
    startRef.current = performance.now();

    // Snap immediately only on first value
    if (displayRef.current == null) {
      setDisplay(Number(target.toFixed(decimals)));
    }
  }, [target, decimals]);

  // Continuous animation loop (independent of target effect restarts)
  useEffect(() => {
    let frame = 0;

    const tick = (now: number) => {
      const to = toRef.current;
      const from = fromRef.current;
      if (to == null || from == null) {
        frame = requestAnimationFrame(tick);
        return;
      }

      const elapsed = now - startRef.current;
      const t = Math.min(1, elapsed / durationMs);
      // Smoothstep for natural motion without end-of-second stall feeling
      const eased = t * t * (3 - 2 * t);
      const value = from + (to - from) * eased;
      const next = Number(value.toFixed(decimals));

      if (displayRef.current !== next) {
        setDisplay(next);
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [durationMs, decimals]);

  return display;
}
