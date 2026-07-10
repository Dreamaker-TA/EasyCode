import type { ReactNode } from "react";

import { Button } from "./Button";
import styles from "./EmptyState.module.css";

interface Action {
  label: string;
  /** 路由跳转（渲染 Link 样式按钮）。 */
  to?: string;
  /** 命令式动作（渲染 button）。to 与 onClick 二选一。 */
  onClick?: () => void;
}

interface Props {
  /** 等宽 kicker 小标签（如「复习队列」「历史记录」）。 */
  kicker: string;
  /** 一句话陈述事实（中文散文、具体、不卖萌，设计规范）。 */
  message: ReactNode;
  /** 可选单一动作按钮。 */
  action?: Action;
  className?: string;
}

/**
 * EmptyState —— 共享空态原语。
 * kicker + 一句话陈述 + 可选动作按钮，语气统一。
 * 禁止组件用静默 return null 做空态。
 */
export function EmptyState({ kicker, message, action, className }: Props) {
  return (
    <div
      className={[styles.wrap, className ?? ""].filter(Boolean).join(" ")}
      data-qa="empty-state"
    >
      <p className={`kicker ${styles.kicker}`}>{kicker}</p>
      <p className={styles.message}>{message}</p>
      {action &&
        (action.to ? (
          <Button as="link" to={action.to} variant="secondary" size="md" className={styles.action}>
            {action.label}
          </Button>
        ) : (
          <Button variant="secondary" size="md" className={styles.action} onClick={action.onClick}>
            {action.label}
          </Button>
        ))}
    </div>
  );
}
