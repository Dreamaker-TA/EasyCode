import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { getProblemTests } from "@/api/execution";
import type { ProblemTests, RunResult } from "@/api/types";
import { PyodideLoadError, run as runPyodide } from "@/lib/pyodide-runner";

/**
 * 在浏览器 Web Worker 里用 Pyodide 跑测试。
 *
 * 不走网络（执行在本地 worker），故用原生 useState 态机而非 TanStack（参考 useSnapshotLoop）。
 * 切题自动 reset；runSeqRef 防卸载/切题后旧 run 落后回写。
 */
export type RunPhase = "idle" | "loading_runtime" | "running" | "done" | "error";

interface RunState {
  phase: RunPhase;
  result: RunResult | null;
  error: string | null;
}

const INITIAL: RunState = { phase: "idle", result: null, error: null };

export function useRunCode(problemId: number) {
  const qc = useQueryClient();
  const [state, setState] = useState<RunState>(INITIAL);
  const runSeqRef = useRef(0);

  useEffect(() => {
    // 切题：作废在途 run 并重置。
    runSeqRef.current++;
    setState(INITIAL);
  }, [problemId]);

  const run = useCallback(
    async (code: string, includeHidden = false): Promise<RunResult | null> => {
      const seq = ++runSeqRef.current;
      const commit = (next: RunState) => {
        if (runSeqRef.current === seq) setState(next);
      };
      try {
        // 复用缓存避免重复请求。样例快测（手动「运行测试」）与全量通道（submit 接地）用不同
        // key —— 后者带 include_hidden，不污染面板/useProblemTests 的样例缓存。
        const tests = await qc.ensureQueryData<ProblemTests>({
          queryKey: includeHidden
            ? ["problem-tests-full", problemId]
            : ["problem-tests", problemId],
          queryFn: () => getProblemTests(problemId, includeHidden),
        });
        // 样例模式只跑样例；全量模式跑所有带 I/O 的用例。后端若 EXECUTOR=none 屏蔽了非样例
        // I/O，则过滤掉 stdin/expected 为 null 的用例 → 自动退化为只跑样例（避免空 I/O 误判）。
        const runnable = !tests.has_tests
          ? []
          : includeHidden
            ? tests.cases.filter((c) => c.stdin !== null && c.expected_stdout !== null)
            : tests.cases.filter((c) => c.is_sample);
        if (runnable.length === 0) {
          commit({ phase: "error", result: null, error: "本题暂无可运行的测试用例。" });
          return null;
        }
        commit({ phase: "loading_runtime", result: null, error: null });
        const result = await runPyodide({
          code,
          cases: runnable,
          checker: tests.checker ?? "token",
          timeLimitMs: tests.time_limit_ms ?? 3000,
          onReady: () => commit({ phase: "running", result: null, error: null }),
        });
        commit({ phase: "done", result, error: null });
        return result;
      } catch (err) {
        const msg =
          err instanceof PyodideLoadError
            ? "浏览器内的 Python 运行环境加载失败。请刷新页面或重试；这不是服务端或 AI 评测失败。"
            : err instanceof Error
              ? err.message
              : "运行失败，请重试。";
        commit({ phase: "error", result: null, error: msg });
        return null;
      }
    },
    [qc, problemId],
  );

  const reset = useCallback(() => {
    runSeqRef.current++;
    setState(INITIAL);
  }, []);

  return { ...state, run, reset };
}
