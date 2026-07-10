import { useQuery } from "@tanstack/react-query";

import { getProblemTests } from "@/api/execution";

/**
 * 门控「运行测试」按钮：读 has_tests 决定是否显示按钮。
 *
 * queryKey 与 useRunCode 内 ensureQueryData 同 key（["problem-tests", id]），
 * 两处共享 react-query 缓存 → 零重复请求。
 */
export function useProblemTests(id: number | undefined) {
  return useQuery({
    queryKey: ["problem-tests", id],
    queryFn: () => getProblemTests(id!),
    enabled: typeof id === "number" && !Number.isNaN(id),
    staleTime: 1000 * 60 * 5,
  });
}
