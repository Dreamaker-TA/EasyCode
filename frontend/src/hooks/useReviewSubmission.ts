import { useMutation } from "@tanstack/react-query";

import { retryReview } from "@/api/submissions";
import type { SubmissionDetail } from "@/api/types";

/**
 * 重新触发 LLM 评测。调 POST /submissions/{id}/review。
 *
 * 起 retry 与 finalize 同一异步状态机：后端置 status=reviewing 立即返回，
 * 后台重跑评测。调用方拿到 reviewing 响应后走
 * usePollSubmissionReview 轮询；缓存同步 / invalidate 在轮询终态处统一做。
 */
export function useReviewSubmission() {
  return useMutation<SubmissionDetail, Error, string>({
    mutationFn: (submissionId: string) => retryReview(submissionId),
  });
}
