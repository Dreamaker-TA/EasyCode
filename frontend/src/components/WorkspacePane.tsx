import type { ReactNode } from "react";

import type { Rating, RunResult, SubmissionDetail } from "@/api/types";
import type { ReviewProgressEvent } from "@/hooks/useReviewProgress";
import type { RunPhase } from "@/hooks/useRunCode";
import type { AppErrorView } from "@/lib/errors";
import type { ReviewExportInfo } from "@/lib/reviewExportMarkdown";
import type { SessionStage } from "@/lib/sessionTimeline";

import { ReviewPanel, type ReviewPhase } from "./ReviewPanel";
import { TestOutputPanel } from "./TestOutputPanel";
import styles from "./WorkspacePane.module.css";

interface TestView {
  phase: RunPhase;
  result: RunResult | null;
  errorMessage: string | null;
  runTestNote?: string | null;
}

interface ReviewView {
  phase: ReviewPhase;
  reviewingElapsedSec: number;
  progressEvents?: ReviewProgressEvent[];
  progressUnavailable?: boolean;
  submission: SubmissionDetail | null;
  errorMessage: string | null;
  errorView?: AppErrorView | null;
  userRating: Rating | null;
  autoRating: Rating | null;
  effectiveRating: Rating | null;
  ratingPending: boolean;
  onPickRating: (next: Rating | null) => void;
  onRetryReview: () => void;
  retryPending: boolean;
  replayHref?: string;
  reviewPlanHref?: string;
  nextProblemHref?: string;
  exportInfo?: ReviewExportInfo | null;
  onRestart: () => void;
}

interface Props {
  stage: SessionStage;
  /** CodeEditor 元素（作答/测试阶段占主区）。 */
  editor: ReactNode;
  test: TestView;
  review: ReviewView;
  runtimeMessage?: string | null;
  /** 用户选 LeetCode 模式但该题无模板 → 已回退 ACM 空白，编辑器上方提示一次。 */
  leetcodeFallbackNotice?: boolean;
  canContinue: boolean;
  onContinue: () => void;
}

const REVIEW_STAGES: SessionStage[] = [
  "submitting",
  "reviewing",
  "reviewed",
  "recoverable_error",
];

/**
 * 答题区（右栏）· 阶段驱动。
 *
 * - 作答/测试：编辑器占主区；跑过样例后底部拉起测试结果 console。
 * - 提交/评测/复盘/可恢复错误：编辑器已只读，右栏整块交给评测进度与复盘，
 *   代码可通过复盘里的「查看回放」回看。续编（C/D 正计时）会把状态切回作答，编辑器随之回归。
 */
export function WorkspacePane({
  stage,
  editor,
  test,
  review,
  runtimeMessage,
  leetcodeFallbackNotice = false,
  canContinue,
  onContinue,
}: Props) {
  if (REVIEW_STAGES.includes(stage)) {
    return (
      <div className={styles.reviewRegion}>
        <div className={styles.reviewScroll}>
          <h2 className={styles.reviewHeading}>
            {stage === "reviewed"
              ? "本局复盘"
              : stage === "recoverable_error"
                ? "评测可重试"
                : "评测进度"}
          </h2>
          {runtimeMessage && <p className={styles.runtimeNote}>{runtimeMessage}</p>}
          <ReviewPanel
            {...review}
            canContinue={stage === "reviewed" ? canContinue : false}
            onContinue={stage === "reviewed" ? onContinue : undefined}
          />
        </div>
      </div>
    );
  }

  const showConsole = stage === "testing";
  return (
    <div className={styles.workspace}>
      {leetcodeFallbackNotice && (
        <p className={styles.fallbackNotice}>
          该题暂无 LeetCode 函数模板，已使用 ACM 空白编辑器：请自行读取标准输入并输出结果。
        </p>
      )}
      <div className={styles.editorRegion}>{editor}</div>
      {showConsole && (
        <div className={styles.console}>
          <div className={styles.consoleHeader}>本地测试结果</div>
          <div className={styles.consoleBody}>
            <TestOutputPanel
              phase={test.phase}
              result={test.result}
              errorMessage={test.errorMessage}
              executionNote={test.runTestNote}
            />
          </div>
        </div>
      )}
    </div>
  );
}
