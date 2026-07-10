import { useQuery } from "@tanstack/react-query";

import { listSubmissionsForProblem } from "@/api/submissions";

export function useSubmissionHistory(problemId: number | undefined) {
  return useQuery({
    queryKey: ["submissions", problemId],
    queryFn: () => listSubmissionsForProblem(problemId!, { status: "all" }),
    enabled: typeof problemId === "number" && !Number.isNaN(problemId),
    staleTime: 30_000,
  });
}
