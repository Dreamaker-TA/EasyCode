import { useEffect, useRef, useState } from "react";

interface UseCountUpOptions {
  enabled?: boolean;
  durationMs?: number;
}

interface CountUpState {
  value: number;
  changed: boolean;
}

export function useCountUp(
  target: number,
  {
    enabled = true,
    durationMs = 260,
  }: UseCountUpOptions = {},
): CountUpState {
  const [value, setValue] = useState(target);
  const [changed, setChanged] = useState(false);
  const lastTargetRef = useRef(target);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      initializedRef.current = false;
      lastTargetRef.current = target;
      setValue(target);
      setChanged(false);
      return;
    }

    if (!initializedRef.current) {
      initializedRef.current = true;
      lastTargetRef.current = target;
      setValue(target);
      setChanged(false);
      return;
    }

    const start = lastTargetRef.current;
    if (start === target) return;

    lastTargetRef.current = target;
    setChanged(true);
    const startedAt = performance.now();
    let frame = 0;
    let clearTimer = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 4);
      setValue(Math.round(start + (target - start) * eased));
      if (progress < 1) {
        frame = window.requestAnimationFrame(tick);
      } else {
        clearTimer = window.setTimeout(() => setChanged(false), 120);
      }
    };

    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(clearTimer);
    };
  }, [durationMs, enabled, target]);

  return { value, changed };
}
