import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getLLMSettings, patchLLMSettings } from "@/api/userSettings";
import { invalidateTrainingAggregates } from "@/lib/queryInvalidation";

export function useLLMSettings() {
  return useQuery({
    queryKey: ["settings", "llm"],
    queryFn: getLLMSettings,
    staleTime: 15_000,
  });
}

export function usePatchLLMSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: patchLLMSettings,
    onSuccess: (data) => {
      queryClient.setQueryData(["settings", "llm"], data);
      void queryClient.invalidateQueries({ queryKey: ["diagnostics"] });
      void queryClient.invalidateQueries({ queryKey: ["meta"] });
      invalidateTrainingAggregates(queryClient);
    },
  });
}
