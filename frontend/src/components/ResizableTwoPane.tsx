import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import styles from "./ResizableTwoPane.module.css";

interface Props {
  left: ReactNode;
  right: ReactNode;
  /** 左栏初始占比（%）。默认 33 —— 题面 1/3、答题区 2/3。 */
  defaultLeftPct?: number;
  minLeftPct?: number;
  minRightPct?: number;
  /** 是否可拖拽调整。false 时按 defaultLeftPct 固定（准备态 50/50 用）。 */
  resizable?: boolean;
  storageKey?: string;
  /** 窄屏「请切换到桌面」提示文案。 */
  narrowNotice?: string;
}

function loadLeft(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

/**
 * 两栏布局 · 自实现 resizer。
 *
 * 使用 CSS Grid 和 pointer drag 实现一个分隔条：左栏题面、右栏答题区。
 * 左栏占比持久化到 localStorage。
 */
export function ResizableTwoPane({
  left,
  right,
  defaultLeftPct = 33,
  minLeftPct = 24,
  minRightPct = 40,
  resizable = true,
  storageKey = "easycode:two-pane",
  narrowNotice = "这页需要同时查看题面和答题区。当前窗口过窄时会隐藏工作台，避免误操作或内容挤压。",
}: Props) {
  const [leftPct, setLeftPct] = useState<number>(() =>
    resizable ? loadLeft(storageKey, defaultLeftPct) : defaultLeftPct,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startLeft: number; width: number } | null>(null);

  useEffect(() => {
    if (resizable) window.localStorage.setItem(storageKey, String(leftPct));
  }, [leftPct, storageKey, resizable]);

  const clamp = useCallback(
    (v: number) => Math.min(100 - minRightPct, Math.max(minLeftPct, v)),
    [minLeftPct, minRightPct],
  );

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      const c = containerRef.current;
      if (!c) return;
      dragRef.current = {
        startX: e.clientX,
        startLeft: leftPct,
        width: c.getBoundingClientRect().width,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [leftPct],
  );

  const onMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const deltaPct = ((e.clientX - d.startX) / d.width) * 100;
      setLeftPct(clamp(d.startLeft + deltaPct));
    },
    [clamp],
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  const gridTemplate = resizable
    ? `${leftPct}fr 6px ${100 - leftPct}fr`
    : `${defaultLeftPct}fr 0 ${100 - defaultLeftPct}fr`;

  return (
    <div
      ref={containerRef}
      className={styles.group}
      style={{ gridTemplateColumns: gridTemplate }}
    >
      <div className={styles.desktopNotice}>
        <h2>请切换到桌面宽度继续练习</h2>
        <p>{narrowNotice}</p>
      </div>
      <div className={styles.pane}>{left}</div>
      {resizable ? (
        <div
          className={styles.handle}
          onPointerDown={startDrag}
          onPointerMove={onMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      ) : (
        <div className={styles.divider} />
      )}
      <div className={styles.pane}>{right}</div>
    </div>
  );
}
