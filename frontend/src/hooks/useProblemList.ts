import { useQuery } from "@tanstack/react-query";

import { listProblems } from "@/api/problems";

export function useProblemList() {
  return useQuery({
    queryKey: ["problems"],
    queryFn: () => listProblems({ limit: 500 }),
    staleTime: 1000 * 60, // 1 分钟
  });
}
