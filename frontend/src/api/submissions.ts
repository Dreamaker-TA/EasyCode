/**
 * 提交 / 快照 / 评测 API。
 */

import { ApiError, api } from "./client";
import type {
  BatchDeleteResult,
  Language,
  RunResult,
  SnapshotBatchResult,
  SnapshotIn,
  SnapshotListResponse,
  SubmissionContinueResponse,
  SubmissionDetail,
  SubmissionDraft,
  SubmissionListResponse,
  SubmissionMode,
} from "./types";

export async function createDraft(
  problemId: number,
  mode: SubmissionMode,
  modeLimitSec: number | null,
  language: Language = "python",
): Promise<SubmissionDraft> {
  const resp = await api.post<SubmissionDraft>("/submissions", {
    problem_id: problemId,
    mode,
    mode_limit_sec: modeLimitSec,
    language,
  });
  return resp.data;
}

export async function postSnapshots(
  submissionId: string,
  snapshots: SnapshotIn[],
): Promise<SnapshotBatchResult> {
  try {
    const resp = await api.post<SnapshotBatchResult>(
      `/submissions/${submissionId}/snapshots`,
      { snapshots },
    );
    return resp.data;
  } catch (e) {
    // submission 已 finalize 后服务端返回 409,属预期路径:静默丢弃这一批,
    // 让上层把队列清空、不再退避重试。
    if (e instanceof ApiError && e.status === 409) {
      return { accepted: 0, duplicates: snapshots.length };
    }
    throw e;
  }
}

export async function finalizeSubmission(
  submissionId: string,
  code: string,
  elapsedSec: number,
  testResults?: RunResult | null,
): Promise<SubmissionDetail> {
  const resp = await api.post<SubmissionDetail>(
    `/submissions/${submissionId}/finalize`,
    // test_results：前端预跑结果仅作协议提示；后端 finalize 会复跑并持久化权威结果。
    { code, elapsed_sec: elapsedSec, test_results: testResults ?? null },
  );
  return resp.data;
}

export async function getSubmission(submissionId: string): Promise<SubmissionDetail> {
  const resp = await api.get<SubmissionDetail>(`/submissions/${submissionId}`);
  return resp.data;
}

export async function retryReview(submissionId: string): Promise<SubmissionDetail> {
  const resp = await api.post<SubmissionDetail>(
    `/submissions/${submissionId}/review`,
  );
  return resp.data;
}

export async function continueSubmission(
  oldSubmissionId: string,
): Promise<SubmissionContinueResponse> {
  const resp = await api.post<SubmissionContinueResponse>(
    `/submissions/${oldSubmissionId}/continue`,
  );
  return resp.data;
}

// === 历史 / 快照 ===

export async function listSubmissionsForProblem(
  problemId: number,
  opts: { status?: "submitted" | "all"; limit?: number } = {},
): Promise<SubmissionListResponse> {
  const resp = await api.get<SubmissionListResponse>(
    `/problems/${problemId}/submissions`,
    { params: { status: opts.status ?? "submitted", limit: opts.limit ?? 20 } },
  );
  return resp.data;
}

export async function listSnapshots(
  submissionId: string,
): Promise<SnapshotListResponse> {
  const resp = await api.get<SnapshotListResponse>(
    `/submissions/${submissionId}/snapshots`,
  );
  return resp.data;
}

export async function deleteSubmission(submissionId: string): Promise<void> {
  await api.delete(`/submissions/${submissionId}`);
}

export async function batchDeleteSubmissions(
  submissionIds: string[],
): Promise<BatchDeleteResult> {
  const resp = await api.post<BatchDeleteResult>(
    `/submissions/batch-delete`,
    { submission_ids: submissionIds },
  );
  return resp.data;
}
