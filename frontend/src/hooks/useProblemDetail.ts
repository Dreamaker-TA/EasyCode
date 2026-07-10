import { useQuery } from "@tanstack/react-query";

import { getProblem } from "@/api/problems";

export function useProblemDetail(id: number | undefined) {
  return useQuery({
    queryKey: ["problem", id],
    queryFn: () => getProblem(id!),
    enabled: typeof id === "number" && !Number.isNaN(id),
    staleTime: 1000 * 60 * 5,
  });
}
