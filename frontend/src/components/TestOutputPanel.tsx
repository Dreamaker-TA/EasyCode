import type { CaseStatus, RunFailure, RunResult, RunVerdict } from "@/api/types";
import type { RunPhase } from "@/hooks/useRunCode";
import {
  isNoOutputFailure,
  runErrorToAppError,
  runResultToAppError,
} from "@/lib/errors";

import { ErrorNotice } from "./ErrorNotice";
import styles from "./TestOutputPanel.module.css";

interface Props {
  phase: RunPhase;
  /** done 时存在 */
  result: RunResult | null;
  /** error 时存在 */
  errorMessage: string | null;
  executionNote?: string | null;
}

const VERDICT_LABEL: Record<RunVerdict, string> = {
  OK: "通过",
  WRONG: "答案错误",
  RUNTIME_ERROR: "运行错误",
  COMPILE_ERROR: "语法错误",
  TLE: "超时",
};

const STATUS_LABEL: Record<CaseStatus, string> = {
  WRONG: "答案错误",
  RUNTIME_ERROR: "运行错误",
  TLE: "超时",
};

/** verdict → 全局 tone 词汇表类名（globals.css tone-*）。 */
function verdictToneClass(v: RunVerdict): string {
  if (v === "OK") return "tone-ok";
  if (v === "WRONG" || v === "TLE") return "tone-warn";
  return "tone-danger"; // RUNTIME_ERROR / COMPILE_ERROR
}

/**
 * 失败严重度 → tone：
 *   WRONG / RUNTIME_ERROR = danger（错到不能算过）
 *   TLE                   = warn（跑通思路但没达标）
 * COMPILE_ERROR 不是 per-case 失败（是顶层 verdict），走上方 trace 呈现。
 */
function severityTone(status: CaseStatus): "danger" | "warn" {
  return status === "TLE" ? "warn" : "danger";
}

/** danger 组永远排在 warn 组之上；组内保持用例原顺序（稳定排序）。 */
const SEVERITY_RANK: Record<CaseStatus, number> = {
  WRONG: 0,
  RUNTIME_ERROR: 0,
  TLE: 1,
};

function sortBySeverity(failures: RunFailure[]): RunFailure[] {
  return failures
    .map((failure, index) => ({ failure, index }))
    .sort((a, b) => {
      const rank = SEVERITY_RANK[a.failure.status] - SEVERITY_RANK[b.failure.status];
      return rank !== 0 ? rank : a.index - b.index;
    })
    .map((entry) => entry.failure);
}

/**
 * 测试输出面板。视觉对齐 ReviewPanel：
 * idle 占位 / loading 文案 / error 错误框 / done 结果（verdict 徽章 + 失败用例卡）。
 * 只展示样例用例内容（防泄）。
 */
export function TestOutputPanel({ phase, result, errorMessage, executionNote }: Props) {
  if (phase === "idle") {
    return (
      <div className={styles.idleGroup}>
        {executionNote && <p className={styles.executionNote}>{executionNote}</p>}
        <p className={styles.idle}>
          点「运行测试」用样例验证代码；提交评测会按当前语言与可用执行证据进入复盘。
        </p>
      </div>
    );
  }

  if (phase === "loading_runtime") {
    return (
      <div className={`inline-wait ${styles.inlineWait}`}>
        <span className="inline-wait-dots">
          <i />
          <i />
          <i />
        </span>
        <span>
          正在准备浏览器内的 Python 运行环境。首次使用时需要下载；这一步在浏览器内完成，不是在等待服务端或 AI 评测。
        </span>
      </div>
    );
  }

  if (phase === "running") {
    return (
      <div className={`inline-wait ${styles.inlineWait}`}>
        <span className="inline-wait-dots">
          <i />
          <i />
          <i />
        </span>
        <span>运行测试中…</span>
      </div>
    );
  }

  if (phase === "error") {
    const error = runErrorToAppError(errorMessage);
    return (
      <div className={styles.errorWrap}>
        <ErrorNotice error={error} />
      </div>
    );
  }

  if (!result) {
    return <p className={styles.idle}>暂无运行结果。</p>;
  }

  const resultError = runResultToAppError(result);

  return (
    <div className={styles.wrap}>
      {resultError && <ErrorNotice error={resultError} />}
      <div className={styles.header}>
        <span className={`${styles.badge} ${verdictToneClass(result.verdict)}`}>
          {VERDICT_LABEL[result.verdict]}
        </span>
        <span className={styles.count}>
          {result.passed}/{result.total} 样例通过
        </span>
      </div>

      {result.verdict === "COMPILE_ERROR" && result.error && (
        <pre className={styles.trace}>{result.error}</pre>
      )}

      {sortBySeverity(result.failures).map((f) => (
        <FailureRow key={f.id} failure={f} />
      ))}

      {result.verdict === "OK" && (
        <p className={styles.allPass}>样例全部通过</p>
      )}
    </div>
  );
}

function FailureRow({ failure }: { failure: RunFailure }) {
  // 防泄：非样例用例只显状态、不显 I/O。
  const showIo = failure.is_sample;
  const tone = severityTone(failure.status);
  return (
    <div className={`${styles.failureRow} tone-${tone}`} data-qa="failure-row">
      <div className={styles.failureHead}>
        <span className={styles.failureStatus}>{STATUS_LABEL[failure.status]}</span>
        <span className={styles.failureTitle}>样例 {failure.id}</span>
      </div>
      {showIo && failure.status === "RUNTIME_ERROR" && failure.stderr && (
        <div className={styles.ioBlock}>
          <div className={styles.ioLabel}>错误</div>
          <pre className={styles.trace}>{failure.stderr}</pre>
        </div>
      )}
      {showIo && failure.status === "WRONG" && (
        <>
          {failure.stdin != null && failure.stdin !== "" && (
            <div className={styles.ioBlock}>
              <div className={styles.ioLabel}>输入</div>
              <pre className={styles.io}>{failure.stdin}</pre>
            </div>
          )}
          <div className={styles.ioBlock}>
            <div className={styles.ioLabel}>期望</div>
            <pre className={styles.io}>{failure.expected ?? ""}</pre>
          </div>
          <div className={styles.ioBlock}>
            <div className={styles.ioLabel}>实际</div>
            {isNoOutputFailure(failure) ? (
              <p className={styles.noOutput}>
                没有任何输出——代码跑完没报错，但没往标准输出打印内容。检查结尾是否漏了{" "}
                <code>main()</code> 调用，或 <code>print(...)</code> 外壳是否被删。
              </p>
            ) : (
              <pre className={styles.io}>{failure.actual ?? ""}</pre>
            )}
          </div>
        </>
      )}
      {showIo && failure.status === "TLE" && (
        <div className={styles.cardBody}>超出时间限制（疑似死循环或效率不足）。</div>
      )}
    </div>
  );
}
