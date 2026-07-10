/**
 * Pyodide runner。
 *
 * 单例 worker + 主线程 per-case 超时 `terminate()` 重建 + verdict 聚合。
 * 纯模块、无 React，便于独立复用。
 */
import type {
  CheckerType,
  PublicTestCase,
  RunFailure,
  RunResult,
  RunVerdict,
} from "@/api/types";
import type { WorkerRequest, WorkerResponse } from "./pyodide.worker";

/** loadPyodide / wasm 加载失败的专用标记：hook 据此转 infra "error" 态（非 verdict、不喂 LLM）。 */
export class PyodideLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PyodideLoadError";
  }
}

/** 内部超时信号（per-case 超 time_limit）。 */
class RunTimeout extends Error {
  constructor() {
    super("TLE");
    this.name = "RunTimeout";
  }
}

let worker: Worker | null = null;
let reqSeq = 0;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./pyodide.worker.ts", import.meta.url), {
      type: "module",
    });
  }
  return worker;
}

function disposeWorker(): void {
  worker?.terminate();
  worker = null;
}

type OkResponse = Extract<WorkerResponse, { kind: "compiled" | "case_result" }>;

// Omit 不分配联合类型（会丢掉各分支的非公共字段），用分配版保留 code/stdin 等。
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
type RequestPayload = DistributiveOmit<WorkerRequest, "reqId">;

/**
 * 发一条请求并等回执。超时 → terminate + 重建 + reject RunTimeout；
 * 致命错（含加载失败）→ terminate + reject PyodideLoadError。
 */
function request(
  req: RequestPayload,
  timeoutMs: number | null,
): Promise<OkResponse> {
  const w = getWorker();
  const reqId = ++reqSeq;
  return new Promise<OkResponse>((resolve, reject) => {
    let timer: number | null = null;
    const cleanup = () => {
      w.removeEventListener("message", onMessage);
      if (timer !== null) window.clearTimeout(timer);
    };
    const onMessage = (e: MessageEvent<WorkerResponse>) => {
      const res = e.data;
      if (res.reqId !== reqId) return;
      cleanup();
      if (res.kind === "fatal") {
        disposeWorker();
        reject(new PyodideLoadError(res.error));
      } else {
        resolve(res);
      }
    };
    w.addEventListener("message", onMessage);
    if (timeoutMs !== null) {
      timer = window.setTimeout(() => {
        cleanup();
        disposeWorker(); // 杀死死循环；下次 run 重建并重新 compile
        reject(new RunTimeout());
      }, timeoutMs);
    }
    w.postMessage({ ...req, reqId } as WorkerRequest);
  });
}

export interface RunArgs {
  code: string;
  /** 只含样例用例（stdin/expected_stdout 非 null）。 */
  cases: PublicTestCase[];
  checker: CheckerType;
  timeLimitMs: number;
  /** Pyodide 加载完成（首次 compile 返回）时回调，用于把 UI 从 loading_runtime 切到 running。 */
  onReady?: () => void;
}

// 顶层 verdict 聚合优先级（单标签；明细在 failures[]）：
// COMPILE_ERROR > RUNTIME_ERROR > TLE > WRONG > OK。
const SEVERITY: Record<RunVerdict, number> = {
  OK: 0,
  WRONG: 1,
  TLE: 2,
  RUNTIME_ERROR: 3,
  COMPILE_ERROR: 4,
};

async function compileOnce(code: string): Promise<string> {
  const res = await request({ kind: "compile", code }, null);
  return res.kind === "compiled" ? res.error : "";
}

export async function run(args: RunArgs): Promise<RunResult> {
  const { code, cases, checker, timeLimitMs, onReady } = args;
  const total = cases.length;

  // 1) 编译（不限时）。语法错 → COMPILE_ERROR，不跑用例。
  const compileError = await compileOnce(code);
  onReady?.(); // 编译已返回 = pyodide 已加载，UI 可切到 running
  if (compileError) {
    return {
      verdict: "COMPILE_ERROR",
      passed: 0,
      total,
      failures: [],
      error: compileError,
    };
  }

  // 2) 逐 case（per-case 超时；TLE 杀 worker 后下个 case 需重新 compile）。
  const failures: RunFailure[] = [];
  let passed = 0;
  let topVerdict: RunVerdict = "OK";
  let recompileNeeded = false;

  const bump = (v: RunVerdict) => {
    if (SEVERITY[v] > SEVERITY[topVerdict]) topVerdict = v;
  };

  for (const c of cases) {
    if (recompileNeeded) {
      const reErr = await compileOnce(code);
      if (reErr) {
        return { verdict: "COMPILE_ERROR", passed, total, failures, error: reErr };
      }
      recompileNeeded = false;
    }

    const stdin = c.stdin ?? "";
    const expected = c.expected_stdout ?? "";
    try {
      const res = await request(
        { kind: "case", stdin, expected, checker },
        timeLimitMs,
      );
      if (res.kind !== "case_result") continue;
      if (res.passed) {
        passed++;
        continue;
      }
      const status: RunFailure["status"] = res.ok ? "WRONG" : "RUNTIME_ERROR";
      failures.push({
        id: c.id,
        is_sample: c.is_sample,
        status,
        // 防泄：仅样例携带 I/O / traceback（样例恒 true；非样例置 null）。
        stdin: c.is_sample ? stdin : null,
        expected: c.is_sample ? expected : null,
        actual: c.is_sample ? res.actual : null,
        stderr: status === "RUNTIME_ERROR" && c.is_sample ? res.stderr : null,
      });
      bump(status);
    } catch (err) {
      if (err instanceof RunTimeout) {
        recompileNeeded = true;
        failures.push({
          id: c.id,
          is_sample: c.is_sample,
          status: "TLE",
          stdin: c.is_sample ? stdin : null,
          expected: c.is_sample ? expected : null,
          actual: null,
          stderr: null,
        });
        bump("TLE");
      } else {
        // PyodideLoadError 等 infra 错：上抛给 hook 转 error 态。
        throw err;
      }
    }
  }

  return { verdict: topVerdict, passed, total, failures };
}
