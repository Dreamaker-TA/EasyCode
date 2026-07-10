import { api } from "./client";
import type { DiagnosticsResponse } from "./types";

/** GET /api/diagnostics：设置、执行器、数据库与题库导入状态。 */
export async function getDiagnostics(): Promise<DiagnosticsResponse> {
  const { data } = await api.get<DiagnosticsResponse>("/diagnostics");
  return data;
}
