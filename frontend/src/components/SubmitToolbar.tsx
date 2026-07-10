import { Button } from "./Button";
import styles from "./SubmitToolbar.module.css";

export type SubmitState = "idle" | "submitting" | "reviewing" | "done" | "error";

interface Props {
  state: SubmitState;
  /** 评测阶段已用秒数（用于按钮文案“AI 评测中…（已用 6 秒）”） */
  reviewingElapsedSec: number;
  /** 是否可点（draft 还没创建 / 无 submissionId 时 false） */
  canSubmit: boolean;
  /** 是否渲染「运行测试」按钮（has_tests && EXECUTOR!=none）。false 时不渲染。 */
  showRunTest: boolean;
  /** 「运行测试」是否可用（showRunTest && 语言==python，当前 Python-only 恒真）。 */
  canRunTest: boolean;
  runTestNote?: string | null;
  /** 运行中（loading_runtime/running）：禁用运行按钮并显示"运行中…"。 */
  running: boolean;
  onSubmit: () => void;
  onRunTest: () => void;
  onAskHelp: () => void;
}

function submitLabel(state: SubmitState, elapsed: number): string {
  switch (state) {
    case "submitting":
      return "提交中…";
    case "reviewing":
      return `AI 评测中…（已用 ${elapsed} 秒）`;
    case "done":
      return "提交成功";
    case "error":
      return "提交（重试）";
    default:
      return "提交";
  }
}

export function SubmitToolbar({
  state,
  reviewingElapsedSec,
  canSubmit,
  showRunTest,
  canRunTest,
  runTestNote,
  running,
  onSubmit,
  onRunTest,
  onAskHelp,
}: Props) {
  const submitDisabled =
    !canSubmit ||
    state === "submitting" ||
    state === "reviewing" ||
    state === "done";

  const busy = state === "submitting" || state === "reviewing";
  const helpDisabled = busy;
  // canRunTest 恒真（Python-only）；运行按钮只随运行中 / 提交忙态禁用，标签自解释无需 tooltip。
  const runDisabled = !canRunTest || running || busy;

  return (
    <div className={styles.wrap}>
      {showRunTest && (
        <Button
          variant="secondary"
          size="lg"
          className={styles.run}
          onClick={onRunTest}
          disabled={runDisabled}
        >
          {running ? "运行中…" : "运行测试"}
        </Button>
      )}
      <Button
        variant="primary"
        size="lg"
        className={styles.submit}
        onClick={onSubmit}
        disabled={submitDisabled}
      >
        {submitLabel(state, reviewingElapsedSec)}
      </Button>
      <Button
        variant="secondary"
        size="lg"
        className={styles.help}
        onClick={onAskHelp}
        disabled={helpDisabled}
      >
        求助
      </Button>
      {runTestNote && <span className={styles.note}>{runTestNote}</span>}
    </div>
  );
}
