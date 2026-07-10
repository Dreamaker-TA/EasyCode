import { ApiError } from "@/api/client";
import type { RunFailure, RunResult, RunVerdict } from "@/api/types";

export type AppErrorKind =
  | "user_code"
  | "configuration"
  | "retryable_system"
  | "network"
  | "not_found"
  | "unknown";

export type AppErrorTone = "info" | "warning" | "danger";

export interface AppErrorAction {
  label: string;
  to?: string;
  onClick?: () => void;
}

export interface AppErrorView {
  kind: AppErrorKind;
  tone: AppErrorTone;
  title: string;
  message: string;
  code?: string;
  primaryAction?: AppErrorAction;
  secondaryAction?: AppErrorAction;
}

interface ErrorOptions {
  title?: string;
  message?: string;
  retryAction?: AppErrorAction;
  settingsAction?: AppErrorAction;
  fallback?: AppErrorView;
}

const SETTINGS_ACTION: AppErrorAction = {
  label: "打开设置诊断",
  to: "/settings",
};

const CODE_KIND: Record<string, AppErrorKind> = {
  LLM_NOT_CONFIGURED: "configuration",
  LLM_UNAVAILABLE: "retryable_system",
  LLM_OUTPUT_INVALID: "retryable_system",
  REVIEW_FAILED: "retryable_system",
  REVIEW_CONTEXT_MISSING: "retryable_system",
  REVIEW_INTERRUPTED: "retryable_system",
  INTERNAL_ERROR: "retryable_system",
  PROBLEM_NOT_FOUND: "not_found",
  SUBMISSION_NOT_FOUND: "not_found",
  HTTP_ERROR: "unknown",
  VALIDATION_ERROR: "unknown",
};

const USER_RECOVERY = "先根据报错修正当前代码，再重新运行测试或提交评测。";

export function toAppError(error: unknown, options: ErrorOptions = {}): AppErrorView {
  if (error instanceof ApiError) {
    return fromApiError(error, options);
  }
  if (error instanceof Error) {
    return {
      kind: "unknown",
      tone: "danger",
      title: options.title ?? "操作没有完成",
      message: options.message ?? "发生了未预期的问题。请重试；如果反复出现，打开设置诊断确认本地服务状态。",
      code: error.name,
      primaryAction: options.retryAction,
      secondaryAction: options.settingsAction ?? SETTINGS_ACTION,
    };
  }
  return (
    options.fallback ?? {
      kind: "unknown",
      tone: "danger",
      title: options.title ?? "操作没有完成",
      message: options.message ?? "发生了未预期的问题。请重试；如果反复出现，打开设置诊断确认本地服务状态。",
      primaryAction: options.retryAction,
      secondaryAction: options.settingsAction ?? SETTINGS_ACTION,
    }
  );
}

export function fromApiError(error: ApiError, options: ErrorOptions = {}): AppErrorView {
  const kind = classifyApiError(error);
  const code = error.code;

  if (kind === "configuration") {
    return {
      kind,
      tone: "warning",
      title: options.title ?? "评测配置还没有准备好",
      message: options.message ?? "当前操作需要配置 AI 评测。请在设置诊断中确认模型服务地址、模型名称和访问密钥后再重试。",
      code,
      primaryAction: options.settingsAction ?? SETTINGS_ACTION,
      secondaryAction: options.retryAction,
    };
  }

  if (kind === "network") {
    return {
      kind,
      tone: "danger",
      title: options.title ?? "连接不到后端",
      message:
        options.message ??
        "请确认本地服务正在运行。如果前端改用了其他端口，请按照项目启动说明检查前端地址是否获后端允许，以及前端连接的后端地址是否正确。",
      code,
      primaryAction: options.retryAction,
      secondaryAction: options.settingsAction ?? SETTINGS_ACTION,
    };
  }

  if (kind === "not_found") {
    return {
      kind,
      tone: "warning",
      title: options.title ?? "内容不存在",
      message: options.message ?? "这条记录可能已被删除，或当前题库已经重新导入。请回到列表重新选择。",
      code,
    };
  }

  if (kind === "retryable_system") {
    return {
      kind,
      tone: "warning",
      title: options.title ?? "系统暂时没有完成请求",
      message: options.message ?? "代码和记录会保留。请稍后重试；如果持续失败，到设置诊断检查 AI 评测、本地运行环境和服务状态。",
      code,
      primaryAction: options.retryAction,
      secondaryAction: options.settingsAction ?? SETTINGS_ACTION,
    };
  }

  return {
    kind,
    tone: "danger",
    title: options.title ?? "操作没有完成",
    message: options.message ?? "请求失败，但当前错误没有更明确的分类。请重试；如果反复出现，打开设置诊断确认环境状态。",
    code,
    primaryAction: options.retryAction,
    secondaryAction: options.settingsAction ?? SETTINGS_ACTION,
  };
}

export function classifyApiError(error: ApiError): AppErrorKind {
  if (error.code === "NETWORK_ERROR" || error.status === 0) return "network";
  const known = CODE_KIND[error.code];
  if (known) return known;
  if (error.status === 404) return "not_found";
  if (error.status === 502 || error.status === 503 || error.status === 504 || error.status >= 500) {
    return "retryable_system";
  }
  return "unknown";
}

export function reviewErrorToAppError(
  errorCode: string | null | undefined,
  rawReason: string | null | undefined,
  retryAction?: AppErrorAction,
): AppErrorView {
  const code = errorCode ?? inferReviewErrorCode(rawReason);
  const apiError = new ApiError(code, rawReason ?? code, code === "LLM_UNAVAILABLE" ? 503 : 500);
  if (code === "REVIEW_INTERRUPTED") {
    return fromApiError(apiError, {
      title: "评测后台已中断",
      message:
        "这次提交和过程记录已经保留，但后台评测没有完成。可以直接重试评测；如果反复出现，请打开设置诊断检查服务和 AI 评测设置。",
      retryAction,
    });
  }
  return fromApiError(apiError, {
    title: code === "LLM_UNAVAILABLE" ? "AI 评测暂时不可用" : undefined,
    retryAction,
  });
}

export function runErrorToAppError(errorMessage: string | null): AppErrorView {
  const isRuntimeLoad = errorMessage?.includes("运行时加载失败");
  const isNoTests = errorMessage?.includes("暂无可运行");
  if (isNoTests) {
    return {
      kind: "configuration",
      tone: "info",
      title: "本题没有可运行测试",
      message: "当前题目没有可运行的测试用例。可以继续提交进行 AI 评测，也可以在题库中补充测试用例后重新导入。",
      code: "TESTS_UNAVAILABLE",
      secondaryAction: SETTINGS_ACTION,
    };
  }
  return {
    kind: isRuntimeLoad ? "retryable_system" : "unknown",
    tone: "warning",
    title: isRuntimeLoad ? "Python 运行时没有加载成功" : "测试没有运行成功",
    message: isRuntimeLoad
      ? "这通常是浏览器内 Python 运行环境的临时问题。请重试；如果持续失败，到设置诊断检查运行环境状态。"
      : "当前测试流程没有完成。请重试；如果持续失败，到设置诊断检查执行器状态。",
    code: isRuntimeLoad ? "PYODIDE_LOAD_FAILED" : "RUN_FAILED",
    secondaryAction: SETTINGS_ACTION,
  };
}

/**
 * 样例判 WRONG 但实际 stdout 为空 —— 代码跑完没报错，却一个字符都没打印。
 * 最常见成因：结尾 `if __name__ == "__main__": main()` 调用行被删（main 只被定义没被执行），
 * 或负责 print 的 ACM 外壳被覆盖掉。只对样例判定（非样例 actual 恒 null，无法据此判断）。
 */
export function isNoOutputFailure(f: RunFailure): boolean {
  return f.is_sample && f.status === "WRONG" && (f.actual ?? "").trim() === "";
}

/** 整体 WRONG 且所有样例 WRONG 均"零输出" → 判定为漏输出（而非逻辑错）。 */
function isNoOutputResult(result: RunResult): boolean {
  if (result.verdict !== "WRONG") return false;
  const sampleWrong = result.failures.filter(
    (f) => f.is_sample && f.status === "WRONG",
  );
  return sampleWrong.length > 0 && sampleWrong.every(isNoOutputFailure);
}

export function runResultToAppError(result: RunResult): AppErrorView | null {
  if (result.verdict === "OK") return null;
  if (isNoOutputResult(result)) {
    return {
      kind: "user_code",
      tone: "warning",
      title: "代码没有任何输出",
      message:
        "样例跑完了、也没报错，但你的程序没有向标准输出打印任何内容。判题按 ACM 方式对比 stdout，空输出 ≠ 期望值，所以判答案错误——这不是编译失败。最常见原因：结尾的 `if __name__ == \"__main__\": main()` 调用行被删掉，`main()` 只被定义、从没执行；或负责 print 的外壳被覆盖。补回调用行 / print 再运行。",
      code: "NO_OUTPUT",
    };
  }
  const titleByVerdict: Record<Exclude<RunVerdict, "OK">, string> = {
    WRONG: "样例输出不一致",
    RUNTIME_ERROR: "代码运行时报错",
    COMPILE_ERROR: "代码存在语法错误",
    TLE: "代码运行超时",
  };
  const messageByVerdict: Record<Exclude<RunVerdict, "OK">, string> = {
    WRONG: "执行器已经跑完样例，实际输出和期望不一致。先对照失败样例修正逻辑。",
    RUNTIME_ERROR: "代码可以启动，但运行过程中抛出了异常。先定位堆栈里的越界、空值或类型问题。",
    COMPILE_ERROR: "Python 语法检查没有通过。先修正语法错误，再运行测试或提交评测。",
    TLE: "样例执行超出时间限制。优先检查死循环；如果不是死循环，再考虑复杂度优化。",
  };
  const verdict = result.verdict as Exclude<RunVerdict, "OK">;
  return {
    kind: "user_code",
    tone: verdict === "WRONG" || verdict === "TLE" ? "warning" : "danger",
    title: titleByVerdict[verdict],
    message: `${messageByVerdict[verdict]} ${USER_RECOVERY}`,
    code: verdict,
  };
}

function inferReviewErrorCode(reason: string | null | undefined): string {
  if (!reason) return "REVIEW_FAILED";
  if (reason.includes("LLM unavailable")) return "LLM_UNAVAILABLE";
  if (reason.includes("LLM output invalid") || reason.includes("schema mismatch")) {
    return "LLM_OUTPUT_INVALID";
  }
  return "REVIEW_FAILED";
}
