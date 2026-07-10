import { useEffect } from "react";

/**
 * 打开浮层时锁定 body 背景滚动，卸载 / 关闭时恢复到进入前的值。
 * Modal / HelpDrawer 共用同一份实现。
 */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [active]);
}
