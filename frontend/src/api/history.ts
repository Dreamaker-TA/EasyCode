/**
 * 跨题目历史聚合 API(供顶部「历史」tab 用)。
 */

import { api } from "./client";
import type { HistoryListResponse } from "./types";

export async function listProblemHistory(
  opts: { limit?: number; offset?: number } = {},
): Promise<HistoryListResponse> {
  const resp = await api.get<HistoryListResponse>("/history/problems", {
    params: { limit: opts.limit ?? 50, offset: opts.offset ?? 0 },
  });
  return resp.data;
}
