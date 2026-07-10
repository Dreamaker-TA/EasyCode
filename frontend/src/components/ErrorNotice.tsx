import type { AppErrorAction, AppErrorView } from "@/lib/errors";

import { Button } from "./Button";
import styles from "./ErrorNotice.module.css";

interface Props {
  error: AppErrorView;
  variant?: "inline" | "panel";
  className?: string;
}

export function ErrorNotice({ error, variant = "inline", className }: Props) {
  const classNames = [
    styles.notice,
    styles[variant],
    styles[`tone_${error.tone}`],
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classNames}>
      <div className={styles.marker} />
      <div className={styles.content}>
        <div className={styles.head}>
          <h3 className={styles.title}>{error.title}</h3>
          <span className={styles.kind}>{kindLabel(error.kind)}</span>
        </div>
        <p className={styles.message}>{error.message}</p>
        {error.code && <div className={styles.code}>错误码：{error.code}</div>}
        {(error.primaryAction || error.secondaryAction) && (
          <div className={styles.actions}>
            {error.primaryAction && (
              <NoticeAction action={error.primaryAction} primary />
            )}
            {error.secondaryAction && (
              <NoticeAction action={error.secondaryAction} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function NoticeAction({
  action,
  primary = false,
}: {
  action: AppErrorAction;
  primary?: boolean;
}) {
  const variant = primary ? "primary" : "secondary";
  if (action.to) {
    return (
      <Button as="link" to={action.to} variant={variant} size="sm">
        {action.label}
      </Button>
    );
  }
  return (
    <Button variant={variant} size="sm" onClick={action.onClick}>
      {action.label}
    </Button>
  );
}

function kindLabel(kind: AppErrorView["kind"]): string {
  switch (kind) {
    case "user_code":
      return "代码问题";
    case "configuration":
      return "配置缺失";
    case "retryable_system":
      return "可重试";
    case "network":
      return "网络";
    case "not_found":
      return "不存在";
    default:
      return "未知";
  }
}
