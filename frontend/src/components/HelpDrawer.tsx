import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { TutorMessage } from "@/api/types";
import { useScrollLock } from "@/hooks/useScrollLock";
import type { AppErrorView } from "@/lib/errors";

import { Button } from "./Button";
import { ErrorNotice } from "./ErrorNotice";
import { TierIndicator } from "./TierIndicator";
import { TutorMessageList } from "./TutorMessageList";
import styles from "./HelpDrawer.module.css";

interface Props {
  open: boolean;
  loading: boolean;
  loadingHistory: boolean;
  error: AppErrorView | null;
  messages: TutorMessage[];
  currentTier: number;
  pendingStudent: string | null;
  streamingText: string;
  streamFallback: boolean;
  onClose: () => void;
  onAsk: (userQuestion: string) => void;
}

export function HelpDrawer({
  open,
  loading,
  loadingHistory,
  error,
  messages,
  currentTier,
  pendingStudent,
  streamingText,
  streamFallback,
  onClose,
  onAsk,
}: Props) {
  const fieldId = useId();
  const endRef = useRef<HTMLDivElement>(null);
  const [question, setQuestion] = useState("");

  useEffect(() => {
    if (!open) return;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [open, messages.length, pendingStudent, streamingText]);

  useScrollLock(open);

  if (!open) return null;

  const handleSend = () => {
    if (loading) return;
    const trimmed = question.trim();
    onAsk(trimmed.length > 0 ? trimmed : "请根据我当前代码给一个分层提示。");
    setQuestion("");
  };

  const pendingMessages = [
    ...(pendingStudent
      ? [{
          key: "pending-student",
          role: "student" as const,
          content: pendingStudent,
          tier_at: currentTier,
          pending: true,
        }]
      : []),
    ...(loading
      ? [{
          key: "pending-tutor",
          role: "tutor" as const,
          content: streamingText,
          tier_at: Math.min(currentTier + 1, 4),
          pending: true,
        }]
      : []),
  ];

  return createPortal(
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <aside className={styles.drawer} data-qa="help-drawer">
        <header className={styles.header}>
          <div className={styles.headerText}>
            <h2 className={styles.title}>求助</h2>
            <span className={styles.subtitle}>多轮对话 · 服务端控制提示阶梯</span>
          </div>
          <Button variant="secondary" size="lg" className={styles.close} onClick={onClose}>
            关闭
          </Button>
        </header>

        <section className={styles.tierPanel}>
          <div className={styles.tierTop}>
            <span className={styles.tierLabel}>当前层级</span>
            <TierIndicator tier={currentTier} />
          </div>
          <p className={styles.tierCopy}>
            层级只由后端推进；助教会在当前层内尽量帮你，但不会越级泄露参考解。
          </p>
        </section>

        <div className={styles.body}>
          {loadingHistory ? (
            <div className={`inline-wait ${styles.loading}`}>
              <span className="inline-wait-dots">
                <i />
                <i />
                <i />
              </span>
              <span>正在加载历史对话……</span>
            </div>
          ) : (
            <TutorMessageList
              messages={messages}
              pendingMessages={pendingMessages}
            />
          )}
          {error && <ErrorNotice error={error} />}
          {streamFallback && !error && (
            <p className={`${styles.fallbackNote} tone-warn`}>
              流式连接中断，已自动切换为普通响应重试。
            </p>
          )}
          <div ref={endRef} />
        </div>

        <div className={styles.askRow}>
          <label className={styles.inputLabel} htmlFor={`${fieldId}-question`}>
            追问
          </label>
          <textarea
            id={`${fieldId}-question`}
            className={styles.input}
            placeholder="例如：我卡在如何处理重复元素"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            disabled={loading}
          />
          <div className={styles.askActions}>
            <Button
              variant="primary"
              size="lg"
              className={styles.askBtn}
              onClick={handleSend}
              disabled={loading}
            >
              {loading ? "请求中…" : "发送"}
            </Button>
            <span className={styles.askHint}>对话会记录到本次提交</span>
          </div>
        </div>
      </aside>
    </>,
    document.body,
  );
}
