import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import styles from "./StatusToast.module.css";

/**
 * StatusToast —— 全站唯一成功反馈原语。
 * 单实例、底部居中、纸面卡片（1px 边框 + --shadow-pop）、约 3s 自动消散。
 * 只承载操作成功类反馈（已删除 / 已保存 / 已更新）；错误一律走 ErrorNotice，不进 toast。
 *
 * 实现是零依赖的模块级 singleton store：任意位置调用 showToast(...) 推入一条消息，
 * <ToastHost/>（挂在 AppShell）订阅并渲染最新一条。无 context wrapper，避开
 * RouterProvider 根组件无法包裹 children 的限制。
 */

interface ToastState {
  id: number;
  message: ReactNode;
}

const AUTO_DISMISS_MS = 3000;

let current: ToastState | null = null;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ToastState | null {
  return current;
}

/** 显示一条成功反馈（同一时刻只保留最新一条，重复触发会重置计时）。 */
export function showToast(message: ReactNode): void {
  seq += 1;
  current = { id: seq, message };
  if (dismissTimer) clearTimeout(dismissTimer);
  dismissTimer = setTimeout(() => {
    current = null;
    dismissTimer = null;
    emit();
  }, AUTO_DISMISS_MS);
  emit();
}

function dismissNow() {
  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  current = null;
  emit();
}

/** 单实例宿主，渲染当前 toast；放在 AppShell 里即可覆盖全站。 */
export function ToastHost() {
  const toast = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!toast) return null;

  return createPortal(
    <div className={styles.viewport}>
      <div
        key={toast.id}
        className={styles.toast}
        data-qa="status-toast"
        onClick={dismissNow}
      >
        <span className={styles.mark}>✓</span>
        <span className={styles.message}>{toast.message}</span>
      </div>
    </div>,
    document.body,
  );
}
