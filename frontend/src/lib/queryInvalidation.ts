import type { QueryClient } from "@tanstack/react-query";

/** Invalidate aggregate training surfaces that derive from submissions, SRS, or runtime mode. */
export function invalidateTrainingAggregates(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ["training", "overview"] });
  void queryClient.invalidateQueries({ queryKey: ["growth-stats"] });
  void queryClient.invalidateQueries({ queryKey: ["reviews", "due"] });
  void queryClient.invalidateQueries({ queryKey: ["history-list"] });
  void queryClient.invalidateQueries({ queryKey: ["problems"] });
}
