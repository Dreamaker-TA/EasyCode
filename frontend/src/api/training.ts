import { api } from "./client";
import type { TrainingOverview } from "./types";

export async function getTrainingOverview(): Promise<TrainingOverview> {
  const resp = await api.get<TrainingOverview>("/training/overview");
  return resp.data;
}
