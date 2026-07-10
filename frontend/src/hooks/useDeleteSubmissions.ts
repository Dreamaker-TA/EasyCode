import { useMutation, useQueryClient } from "@tanstack/react-query";

import { batchDeleteSubmissions, deleteSubmission } from "@/api/submissions";
import type { BatchDeleteResult } from "@/api/types";
import { invalidateTrainingAggregates } from "@/lib/queryInvalidation";

interface Vars {
  ids: string[];
}

export function useDeleteSubmissions(problemId: number | undefined) {
  const qc = useQueryClient();
  return useMutation<BatchDeleteResult, Error, Vars>({
    mutationFn: async ({ ids }) => {
      if (ids.length === 0) return { deleted: 0, not_found: [] };
      if (ids.length === 1) {
        await deleteSubmission(ids[0]);
        return { deleted: 1, not_found: [] };
      }
      return batchDeleteSubmissions(ids);
    },
    onSuccess: () => {
      // 单题历史 & 跨题历史聚合（submissions_count 变了）
      if (problemId !== undefined && !Number.isNaN(problemId)) {
        qc.invalidateQueries({ queryKey: ["submissions", problemId] });
        // 题目详情里的 mastery.last_submission_id 可能因 SET NULL 变化
        qc.invalidateQueries({ queryKey: ["problem", problemId] });
      }
      invalidateTrainingAggregates(qc);
    },
  });
}
