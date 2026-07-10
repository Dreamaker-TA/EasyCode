/**
 * Growth dashboard API.
 */

import { api } from "./client";
import type { GrowthStats } from "./types";

export async function getGrowthStats(windowDays = 7): Promise<GrowthStats> {
  const resp = await api.get<GrowthStats>("/stats/growth", {
    params: { window_days: windowDays },
  });
  return resp.data;
}
