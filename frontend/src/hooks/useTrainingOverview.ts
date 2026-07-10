import { useQuery } from "@tanstack/react-query";

import { getTrainingOverview } from "@/api/training";

export function useTrainingOverview() {
  return useQuery({
    queryKey: ["training", "overview"],
    queryFn: getTrainingOverview,
    staleTime: 60_000,
  });
}
