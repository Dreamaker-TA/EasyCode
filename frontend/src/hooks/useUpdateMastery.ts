import { useMutation, useQueryClient } from "@tanstack/react-query";

import { patchMastery } from "@/api/mastery";
import type {
  MasteryAfterUpdate,
  ProblemDetail,
  ProblemListItem,
  ProblemListResponse,
  Rating,
  SubmissionDetail,
} from "@/api/types";
import { invalidateTrainingAggregates } from "@/lib/queryInvalidation";

interface Vars {
  userRating: Rating | null;
}

/**
 * PATCH /problems/{id}/mastery。
 * 乐观更新 problem detail / list 缓存里的 mastery，失败回滚。
 */
export function useUpdateMastery(problemId: number) {
  const qc = useQueryClient();
  const detailKey = ["problem", problemId];

  return useMutation<
    MasteryAfterUpdate,
    Error,
    Vars,
    { prevDetail: ProblemDetail | undefined }
  >({
    mutationFn: ({ userRating }) => patchMastery(problemId, userRating),
    onMutate: async ({ userRating }) => {
      await qc.cancelQueries({ queryKey: detailKey });
      const prevDetail = qc.getQueryData<ProblemDetail>(detailKey);
      if (prevDetail) {
        const auto = prevDetail.mastery?.auto_rating ?? null;
        const effective = (userRating ?? auto) as Rating | null;
        qc.setQueryData<ProblemDetail>(detailKey, {
          ...prevDetail,
          mastery: {
            auto_rating: auto,
            user_rating: userRating,
            effective_rating: effective,
          },
        });
      }
      return { prevDetail };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevDetail) {
        qc.setQueryData(detailKey, ctx.prevDetail);
      }
    },
    onSuccess: (data) => {
      const latestSubmissionId = qc.getQueryData<ProblemDetail>(detailKey)?.last_submission_id;
      qc.setQueryData<ProblemDetail | undefined>(detailKey, (prev) =>
        prev
          ? {
              ...prev,
              mastery: {
                auto_rating: data.auto_rating,
                user_rating: data.user_rating,
                effective_rating: data.effective_rating,
              },
            }
          : prev,
      );
      // 列表缓存里也同步一下徽标
      qc.setQueriesData<ProblemListResponse>(
        { queryKey: ["problems"] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((it: ProblemListItem) =>
              it.id === problemId
                ? {
                    ...it,
                    mastery: {
                      auto_rating: data.auto_rating,
                      user_rating: data.user_rating,
                      effective_rating: data.effective_rating,
                    },
                  }
                : it,
            ),
          };
        },
      );
      if (latestSubmissionId) {
        qc.setQueryData<SubmissionDetail | undefined>(
          ["submission", latestSubmissionId],
          (prev) =>
            prev
              ? {
                  ...prev,
                  user_rating_override: data.user_rating,
                  review_schedule: scheduleFromMastery(data, prev.review_schedule),
                }
              : prev,
        );
        void qc.invalidateQueries({ queryKey: ["submission", latestSubmissionId] });
      }
      invalidateTrainingAggregates(qc);
    },
  });
}

function scheduleFromMastery(
  result: MasteryAfterUpdate,
  previous: SubmissionDetail["review_schedule"],
): SubmissionDetail["review_schedule"] {
  if (
    !result.next_review_at ||
    result.interval_days === null ||
    !result.effective_rating
  ) {
    return previous;
  }
  return {
    next_review_at: result.next_review_at,
    interval_days: result.interval_days,
    generated_from_rating: result.effective_rating,
    prior_interval_days: previous?.prior_interval_days ?? null,
  };
}
