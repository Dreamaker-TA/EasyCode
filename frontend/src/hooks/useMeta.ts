import { useQuery } from "@tanstack/react-query";

import { getMeta } from "@/api/meta";

/** 运行时元信息。配置在会话内不变 → staleTime: Infinity，只取一次。 */
export function useMeta() {
  return useQuery({
    queryKey: ["meta"],
    queryFn: getMeta,
    staleTime: Infinity,
  });
}
