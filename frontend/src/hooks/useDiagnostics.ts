import { useQuery } from "@tanstack/react-query";

import { getDiagnostics } from "@/api/diagnostics";

export function useDiagnostics() {
  return useQuery({
    queryKey: ["diagnostics"],
    queryFn: getDiagnostics,
    staleTime: 15_000,
  });
}
