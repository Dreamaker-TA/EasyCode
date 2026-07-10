import { useQuery } from "@tanstack/react-query";

import { getSubmission } from "@/api/submissions";
import type { SubmissionDetail } from "@/api/types";

const POLL_INTERVAL_MS = 2000;

/**
 * 异步评测轮询。
 *
 * finalize / retry 后端把 LLM 评测丢给 BackgroundTasks，立即返回 status=reviewing、
 * reviewed_at=null。这里每 2s 轮询 GET /submissions/{id}，直到 reviewed_at 落值
 * （成功 submitted 或降级 review_failed 都会落值）即停。
 *
 * queryKey 与单条详情共享（["submission", id]），评测完成后历史页等也读到新结果。
 */
export function usePollSubmissionReview(
  submissionId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["submission", submissionId],
    queryFn: () => getSubmission(submissionId as string),
    enabled: enabled && !!submissionId,
    staleTime: 0, // 轮询期间总是取最新
    refetchInterval: (query) => {
      const d = query.state.data as SubmissionDetail | undefined;
      return d?.reviewed_at ? false : POLL_INTERVAL_MS;
    },
  });
}
