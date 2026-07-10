/**
 * Pyodide 执行 Web Worker。
 *
 * - module worker：由 pyodide-runner 以 `new Worker(new URL(...), {type:"module"})` 创建。
 * - 懒加载 + 复用实例：首条消息触发 loadPyodide，之后复用同一实例。
 * - self-host：动态 import 静态托管的 `/pyodide/pyodide.mjs`（vite-plugin-static-copy 提供），
 *   `loadPyodide({ indexURL: "/pyodide/" })` —— 绝不回退 CDN。
 * - 每个 case 在全新 namespace 里 exec、`io.StringIO` 重定向 stdin/stdout（执行后还原），
 *   隔离用户全局、防 case 间串味。
 * - 超时由主线程 `terminate()` 兜底（worker 同步执行无法自中断）。
 */
import type { PyodideAPI } from "pyodide";

// === 主线程 <-> worker 消息协议（runner 复用这些类型）===
export type WorkerRequest =
  | { kind: "compile"; reqId: number; code: string }
  | {
      kind: "case";
      reqId: number;
      stdin: string;
      expected: string;
      checker: string;
    };

export type WorkerResponse =
  | { kind: "compiled"; reqId: number; error: string } // error="" 表示编译通过
  | {
      kind: "case_result";
      reqId: number;
      ok: boolean; // 无运行异常
      passed: boolean; // ok 且输出匹配
      actual: string;
      stderr: string;
    }
  | { kind: "fatal"; reqId: number; error: string }; // 加载/运行时致命错（infra）

// 在 DOM lib 下把 worker 全局当作 Worker 用，规避 DOM/WebWorker 的 self 类型冲突。
const ctx = self as unknown as Worker;

// globals.set 在 PyProxy 基类型上未暴露，窄化避免 any 扩散。
interface PyGlobals {
  set(name: string, value: unknown): void;
}

// 持久化 Python 辅助函数：编译一次缓存到 _COMPILED，每 case 在全新 ns 里复用。
const SETUP = `
import sys, io, json, traceback

_COMPILED = None

def _ec_compile(code):
    global _COMPILED
    try:
        _COMPILED = compile(code, "<user>", "exec")
        return ""
    except SyntaxError as e:
        return f"{type(e).__name__}: {e}"

def _ec_run_case(stdin_data):
    out = io.StringIO()
    old_in, old_out = sys.stdin, sys.stdout
    sys.stdin = io.StringIO(stdin_data)
    sys.stdout = out
    ns = {"__name__": "__main__"}
    try:
        exec(_COMPILED, ns)
        return json.dumps({"actual": out.getvalue(), "ok": True, "stderr": ""})
    except BaseException:
        return json.dumps({"actual": out.getvalue(), "ok": False, "stderr": traceback.format_exc()})
    finally:
        sys.stdin, sys.stdout = old_in, old_out
`;

let pyodide: PyodideAPI | null = null;

// 运行时托管路径（vite-plugin 无关，由 public/pyodide/ 提供）。声明为 string 让
// TS 不静态解析此模块；@vite-ignore 让 Vite 不在构建期打包，留作运行时 fetch。
const PYODIDE_ESM_URL: string = "/pyodide/pyodide.mjs";

async function ensurePyodide(): Promise<PyodideAPI> {
  if (pyodide) return pyodide;
  const mod = (await import(/* @vite-ignore */ PYODIDE_ESM_URL)) as {
    loadPyodide: (cfg: { indexURL: string }) => Promise<PyodideAPI>;
  };
  const py = await mod.loadPyodide({ indexURL: "/pyodide/" });
  py.runPython(SETUP);
  pyodide = py;
  return py;
}

// token 比较：空白归一化，对齐 Python str.split()（折叠所有空白、去首尾、丢空 token）。
function normalizeTokens(s: string): string {
  return s.trim().split(/\s+/).filter(Boolean).join(" ");
}

// float：按 token 切分，逐个按数值比较（绝对/相对容差 1e-6）；非数值 token 退化为逐字相等。
function floatMatches(actual: string, expected: string): boolean {
  const a = actual.trim().split(/\s+/).filter(Boolean);
  const e = expected.trim().split(/\s+/).filter(Boolean);
  if (a.length !== e.length) return false;
  const TOL = 1e-6;
  for (let i = 0; i < e.length; i += 1) {
    const ev = Number(e[i]);
    const av = Number(a[i]);
    if (Number.isNaN(ev) || Number.isNaN(av)) {
      if (a[i] !== e[i]) return false;
      continue;
    }
    const diff = Math.abs(av - ev);
    if (diff > TOL && diff > TOL * Math.abs(ev)) return false;
  }
  return true;
}

function outputMatches(actual: string, expected: string, checker: string): boolean {
  if (checker === "exact") {
    // exact：忽略行尾空白与末尾换行，其余逐字符相等。
    const norm = (t: string) => t.replace(/[ \t]+$/gm, "").replace(/\n+$/, "");
    return norm(actual) === norm(expected);
  }
  if (checker === "float") return floatMatches(actual, expected);
  // token（默认）。custom 暂按 token 处理；多解题可通过外壳侧规范化输出。
  return normalizeTokens(actual) === normalizeTokens(expected);
}

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    const py = await ensurePyodide();
    const globals = py.globals as unknown as PyGlobals;
    if (msg.kind === "compile") {
      globals.set("_ec_code", msg.code);
      const error = py.runPython("_ec_compile(_ec_code)") as string;
      ctx.postMessage({
        kind: "compiled",
        reqId: msg.reqId,
        error,
      } satisfies WorkerResponse);
    } else {
      globals.set("_ec_stdin", msg.stdin);
      const raw = py.runPython("_ec_run_case(_ec_stdin)") as string;
      const r = JSON.parse(raw) as {
        actual: string;
        ok: boolean;
        stderr: string;
      };
      const passed = r.ok && outputMatches(r.actual, msg.expected, msg.checker);
      ctx.postMessage({
        kind: "case_result",
        reqId: msg.reqId,
        ok: r.ok,
        passed,
        actual: r.actual,
        stderr: r.stderr,
      } satisfies WorkerResponse);
    }
  } catch (err) {
    ctx.postMessage({
      kind: "fatal",
      reqId: msg.reqId,
      error: err instanceof Error ? err.message : String(err),
    } satisfies WorkerResponse);
  }
};
