import { useEffect, useRef, useState } from "react";

/** Smooth lerp toward each new target (~durationMs). */
export function useSmoothNumber(
  target: number | null | undefined,
  opts?: { durationMs?: number; decimals?: number },
): number | null {
  const durationMs = opts?.durationMs ?? 1100;
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

    if (displayRef.current == null) {
      setDisplay(Number(target.toFixed(decimals)));
    }
  }, [target, decimals]);

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
      const eased = t * t * (3 - 2 * t);
      const value = from + (to - from) * eased;
      const next = Number(value.toFixed(decimals));
      if (displayRef.current !== next) setDisplay(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [durationMs, decimals]);

  return display;
}
