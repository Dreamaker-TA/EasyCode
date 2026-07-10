import { useQuery } from "@tanstack/react-query";

import { listDue } from "@/api/mastery";

export function useReviewsDue() {
  return useQuery({
    queryKey: ["reviews", "due"],
    queryFn: () => listDue(),
    staleTime: 60_000,
  });
}
