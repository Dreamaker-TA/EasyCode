/**
 * 执行接地 API：取一道题的测试用例。
 *
 * 复用的 GET /problems/{id}/tests。防泄不变量由后端保证：
 * 默认非样例用例的 stdin/expected_stdout/note 为 null（见 schemas/testcase.py）。
 *
 * 全量通道：`includeHidden=true` 传 `?include_hidden=1`，后端在 EXECUTOR!=none 时
 * 下发非样例 I/O，供 submit 跑全量用例强化 grounding（破防泄边界，仅本地单用户）。
 */
import { api } from "./client";
import type { ProblemTests } from "./types";

export async function getProblemTests(
  problemId: number,
  includeHidden = false,
): Promise<ProblemTests> {
  const resp = await api.get<ProblemTests>(`/problems/${problemId}/tests`, {
    params: includeHidden ? { include_hidden: 1 } : undefined,
  });
  return resp.data;
}
