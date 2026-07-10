import { api } from "./client";
import type { ProblemDetail, ProblemListResponse } from "./types";

export interface ListProblemsParams {
  category?: string;
  core_only?: boolean;
  q?: string;
  limit?: number;
  offset?: number;
}

export async function listProblems(
  params: ListProblemsParams = {},
): Promise<ProblemListResponse> {
  const resp = await api.get<ProblemListResponse>("/problems", { params });
  return resp.data;
}

export async function getProblem(id: number): Promise<ProblemDetail> {
  const resp = await api.get<ProblemDetail>(`/problems/${id}`);
  return resp.data;
}
