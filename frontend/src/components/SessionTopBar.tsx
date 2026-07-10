import { useState } from "react";

import type { SubmissionMode } from "@/api/types";
import type { ReviewPhase } from "./ReviewPanel";
import type { TimelineStage } from "@/lib/sessionTimeline";

import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { SubmitToolbar } from "./SubmitToolbar";
import styles from "./SessionTopBar.module.css";

interface TimerView {
  mode: SubmissionMode;
  elapsedSec: number;
  remainingSec: number | null;
  overdue: boolean;
  paused: boolean;
  onTogglePause: () => void;
  onReset: () => void;
}

interface TestView {
  showRunTest: boolean;
  canRunTest: boolean;
  runTestNote?: string | null;
  running: boolean;
  onRunTest: () => void;
}

interface SubmitView {
  state: ReviewPhase;
  reviewingElapsedSec: number;
  canSubmit: boolean;
  onSubmit: () => void;
  onAskHelp: () => void;
}

interface Props {
  backLabel: string;
  onBack: () => void;
  /** 本局已创建（draft 存在）→ 渲染计时器、阶段进度与动作按钮。 */
  hasSession: boolean;
  timeline: TimelineStage[];
  timer: TimerView | null;
  test: TestView;
  submit: SubmitView;
}

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function SessionTopBar({
  backLabel,
  onBack,
  hasSession,
  timeline,
  timer,
  test,
  submit,
}: Props) {
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  return (
    <div className={`${styles.bar} ${hasSession ? styles.barTall : ""}`}>
      <Button
        variant="ghost"
        size="sm"
        className={styles.backBtn}
        onClick={onBack}
        title={`返回${backLabel}`}
      >
        <span className={styles.arrow}>←</span>
        <span>返回 {backLabel}</span>
      </Button>

      {hasSession && (
        <ol className={styles.stepper} data-qa="training-flow">
          {timeline.map((stage, index) => (
            <li
              key={stage.id}
              className={[
                styles.step,
                stage.status === "current" ? styles.stepCurrent : "",
                stage.status === "done" ? styles.stepDone : "",
              ]
                .filter(Boolean)
                .join(" ")}
              data-current={stage.status === "current" ? "true" : undefined}
              title={stage.summary}
            >
              <span className={styles.stepDot}>{index + 1}</span>
              <span className={styles.stepLabel}>{stage.label}</span>
            </li>
          ))}
        </ol>
      )}

      {hasSession && (
        <div className={styles.controls}>
          {timer && (
            <div
              className={`${styles.timer} ${timer.overdue ? styles.timerOverdue : ""} ${
                timer.paused ? styles.timerPaused : ""
              }`}
            >
              <span className={styles.timerLabel}>
                {timer.mode === "timed" ? "倒计时" : "用时"}
                {timer.paused && <span className={styles.pausedBadge}>已暂停</span>}
              </span>
              <span className={styles.timerValue}>
                {timer.mode === "timed" && timer.remainingSec !== null
                  ? fmt(timer.remainingSec)
                  : fmt(timer.elapsedSec)}
              </span>
              {timer.mode === "timed" && (
                <span className={styles.timerSub}>已用 {fmt(timer.elapsedSec)}</span>
              )}
              <Button
                variant="secondary"
                size="sm"
                className={styles.timerBtn}
                onClick={timer.onTogglePause}
              >
                {timer.paused ? "继续" : "暂停"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={styles.timerBtn}
                onClick={() => setResetConfirmOpen(true)}
              >
                重置
              </Button>
            </div>
          )}

          <SubmitToolbar
            state={submit.state}
            reviewingElapsedSec={submit.reviewingElapsedSec}
            canSubmit={submit.canSubmit}
            showRunTest={test.showRunTest}
            canRunTest={test.canRunTest}
            runTestNote={test.runTestNote}
            running={test.running}
            onSubmit={submit.onSubmit}
            onRunTest={test.onRunTest}
            onAskHelp={submit.onAskHelp}
          />
        </div>
      )}

      {timer && (
        <ConfirmDialog
          open={resetConfirmOpen}
          title="重置会作废当前草稿并新建一次提交，确认？"
          description="当前计时与草稿代码会清空，并开始一次全新的提交。此操作不可撤销。"
          confirmLabel="重置"
          variant="danger"
          onConfirm={() => {
            setResetConfirmOpen(false);
            timer.onReset();
          }}
          onCancel={() => setResetConfirmOpen(false)}
        />
      )}
    </div>
  );
}
