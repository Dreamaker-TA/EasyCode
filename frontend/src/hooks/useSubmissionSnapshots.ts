import { useQuery } from "@tanstack/react-query";

import { listSnapshots } from "@/api/submissions";

/**
 * 拉一次提交的所有快照（按 t_offset_sec 升序），供历史详情页的过程回放消费。
 * 仅在 submissionId 非空时触发（详情打开即懒取）；已 finalize 的提交快照不会再变，
 * 故 staleTime 给足，避免重复请求。
 */
export function useSubmissionSnapshots(submissionId: string | null) {
  return useQuery({
    queryKey: ["snapshots", submissionId],
    queryFn: () => listSnapshots(submissionId!),
    enabled: !!submissionId,
    staleTime: 5 * 60_000, // 5 分钟
  });
}
