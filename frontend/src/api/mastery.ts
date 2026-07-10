/**
 * Mastery / SRS API。/12 消费。
 */

import { api } from "./client";
import type { DueResponse, MasteryAfterUpdate, Rating } from "./types";

export async function patchMastery(
  problemId: number,
  userRating: Rating | null,
): Promise<MasteryAfterUpdate> {
  const resp = await api.patch<MasteryAfterUpdate>(
    `/problems/${problemId}/mastery`,
    { user_rating: userRating },
  );
  return resp.data;
}

export async function listDue(limit = 100): Promise<DueResponse> {
  const resp = await api.get<DueResponse>("/reviews/due", {
    params: { limit },
  });
  return resp.data;
}
