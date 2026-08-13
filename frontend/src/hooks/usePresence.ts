import { useEffect, useState } from "react";

/**
 * 在关闭后短暂保留节点，让浮层能够播放退出动效。
 * duration 应与对应 CSS 的退出时长一致。
 */
export function usePresence(open: boolean, duration = 160) {
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setRendered(true);
      setClosing(false);
      return;
    }
    if (!rendered) return;

    setClosing(true);
    const timer = window.setTimeout(() => {
      setRendered(false);
      setClosing(false);
    }, duration);
    return () => window.clearTimeout(timer);
  }, [duration, open, rendered]);

  return { rendered, closing };
}
