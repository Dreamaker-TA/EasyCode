import { useEffect, useRef, useState } from "react";

import type {
  ReviewProgressEvent,
  ReviewProgressStage,
} from "@/hooks/useReviewProgress";

import styles from "./ReviewProgressTimeline.module.css";

interface Props {
  events: ReviewProgressEvent[];
  elapsedSec: number;
}

interface StepView {
  key: ReviewProgressStage | "judge";
  title: string;
  body: string;
  state: "done" | "active" | "pending";
}

const ORDER: Array<ReviewProgressStage | "judge"> = [
  "queued",
  "judge",
  "guardrail",
  "done",
];

export function ReviewProgressTimeline({ events, elapsedSec }: Props) {
  const visibleEvents = useMinimumStepEvents(events, 250);
  const steps = buildSteps(visibleEvents);

  return (
    <section className={styles.wrap} data-qa="review-progress-timeline">
      <div className={styles.head}>
        <div>
          <p className="kicker">评测中</p>
          <h2 className={styles.title}>正在检查这次提交</h2>
        </div>
        <span className={styles.elapsed}>{elapsedSec}s</span>
      </div>
      <ol className={styles.timeline}>
        {steps.map((step) => (
          <li
            key={step.key}
            className={`${styles.step} ${styles[`step_${step.state}`]}`}
            data-current={step.state === "active" ? "true" : undefined}
          >
            <span className={styles.marker} />
            <div className={styles.copy}>
              <strong>{step.title}</strong>
              <span>{step.body}</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function useMinimumStepEvents(
  events: ReviewProgressEvent[],
  minStepMs: number,
): ReviewProgressEvent[] {
  const [visibleEvents, setVisibleEvents] = useState<ReviewProgressEvent[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (events.length < visibleEvents.length) {
      setVisibleEvents(events);
      return;
    }
    if (events.length === visibleEvents.length || timerRef.current !== null) {
      return;
    }

    const delay = minStepMs <= 0 || visibleEvents.length === 0 ? 0 : minStepMs;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setVisibleEvents(events.slice(0, visibleEvents.length + 1));
    }, delay);

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [events, minStepMs, visibleEvents]);

  return visibleEvents;
}

function buildSteps(events: ReviewProgressEvent[]): StepView[] {
  const ordered = ORDER;
  const currentIndex = currentStepIndex(events, ordered);
  return ordered.map((key, index) => ({
    key,
    title: titleForStep(key),
    body: bodyForStep(key, events),
    state:
      index < currentIndex ? "done" : index === currentIndex ? "active" : "pending",
  }));
}

function currentStepIndex(
  events: ReviewProgressEvent[],
  ordered: Array<ReviewProgressStage | "judge">,
): number {
  if (events.length === 0) return 0;
  const last = events[events.length - 1];
  const currentKey = stepKeyForStage(last.stage);
  const index = ordered.indexOf(currentKey);
  return index >= 0 ? index : 0;
}

function stepKeyForStage(stage: ReviewProgressStage): ReviewProgressStage | "judge" {
  if (stage === "deterministic_shortcut" || stage === "llm_sampling") {
    return "judge";
  }
  return stage;
}

function titleForStep(key: ReviewProgressStage | "judge"): string {
  switch (key) {
    case "queued":
      return "已提交";
    case "judge":
      return "生成评分";
    case "guardrail":
      return "检查结果";
    case "done":
      return "准备复盘";
    default:
      return "评测中";
  }
}

function bodyForStep(
  key: ReviewProgressStage | "judge",
  events: ReviewProgressEvent[],
): string {
  if (key === "queued") return "已收到代码和过程记录。";
  if (key === "guardrail") {
    const event = latest(events, "guardrail");
    if (!event) return "正在对照运行结果，避免误判。";
    return event.detail?.applied === true
      ? "运行结果有冲突，已下调评分。"
      : "运行结果和评分一致。";
  }
  if (key === "done") {
    const event = latest(events, "done");
    if (!event) return "正在整理复盘。";
    return event.detail?.status === "review_failed"
      ? "评测没有完成，正在准备重试信息。"
      : "评测完成，正在打开复盘。";
  }

  const deterministic = latest(events, "deterministic_shortcut");
  if (deterministic) {
    const verdict = typeof deterministic.detail?.verdict === "string"
      ? deterministic.detail.verdict
      : "运行错误";
    return `运行结果已经说明问题：${verdict}。`;
  }
  const sampling = latest(events, "llm_sampling");
  if (!sampling) return "正在选择评测方式。";
  const sampleK = formatDetailNumber(sampling.detail?.sample_k);
  const sampleN = formatDetailNumber(sampling.detail?.sample_n);
  return `正在评测第 ${sampleK}/${sampleN} 轮。`;
}

function latest(
  events: ReviewProgressEvent[],
  stage: ReviewProgressStage,
): ReviewProgressEvent | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].stage === stage) return events[i];
  }
  return null;
}

function formatDetailNumber(value: unknown): string {
  return typeof value === "number" ? String(value) : "-";
}
