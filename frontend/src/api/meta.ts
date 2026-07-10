import { api } from "./client";
import type { Meta } from "./types";

/** GET /api/meta：运行时配置（执行器 / 版本）。 */
export async function getMeta(): Promise<Meta> {
  const { data } = await api.get<Meta>("/meta");
  return data;
}
