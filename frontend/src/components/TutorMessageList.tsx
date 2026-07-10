import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { TutorMessage } from "@/api/types";

import { TierIndicator } from "./TierIndicator";
import styles from "./TutorMessageList.module.css";

interface DraftTutorMessage {
  key: string;
  role: "student" | "tutor";
  content: string;
  tier_at: number;
  pending?: boolean;
}

interface Props {
  messages: TutorMessage[];
  pendingMessages?: DraftTutorMessage[];
}

export function TutorMessageList({ messages, pendingMessages = [] }: Props) {
  const items: DraftTutorMessage[] = [
    ...messages.map((message) => ({
      key: String(message.id),
      role: message.role,
      content: message.content,
      tier_at: message.tier_at,
      pending: false,
    })),
    ...pendingMessages,
  ];

  if (items.length === 0) {
    return (
      <p className={styles.empty}>
        发送一个问题后，助教会按 4 层提示阶梯回复；每轮历史都会保留在这里。
      </p>
    );
  }

  return (
    <ol className={styles.list}>
      {items.map((message) => (
        <li
          key={message.key}
          className={`${styles.item} ${styles[message.role]} ${message.pending ? styles.pending : ""}`}
        >
          <div className={styles.meta}>
            <span className={styles.role}>
              {message.role === "student" ? "你" : "助教"}
            </span>
            {message.role === "tutor" && (
              <TierIndicator tier={message.tier_at} compact />
            )}
          </div>
          <div className={styles.bubble}>
            {message.role === "tutor" ? (
              <div className="prose-serif">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.content || "正在组织提示……"}
                </ReactMarkdown>
              </div>
            ) : (
              <p>{message.content}</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
