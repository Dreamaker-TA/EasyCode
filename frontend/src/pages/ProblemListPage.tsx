import { useMemo, useState } from "react";

import type { ProblemListItem } from "@/api/types";
import { CoreFilterToggle } from "@/components/CoreFilterToggle";
import { ProblemListGrouped } from "@/components/ProblemListGrouped";
import { SearchBar } from "@/components/SearchBar";
import { TrainingOverview } from "@/components/TrainingOverview";
import { useProblemList } from "@/hooks/useProblemList";
import { useTrainingOverview } from "@/hooks/useTrainingOverview";

import styles from "./ProblemListPage.module.css";

function matchesSearch(p: ProblemListItem, q: string): boolean {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  if (p.title.toLowerCase().includes(needle)) return true;
  if (p.leetcode_id !== null && String(p.leetcode_id).includes(needle)) return true;
  if (p.external_id && p.external_id.toLowerCase().includes(needle)) return true;
  return false;
}

export function ProblemListPage() {
  const [query, setQuery] = useState("");
  const [coreOnly, setCoreOnly] = useState(false);
  const { data, isLoading, error } = useProblemList();
  const {
    data: overview,
    isLoading: overviewLoading,
    error: overviewError,
  } = useTrainingOverview();

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.items.filter((p) => {
      if (coreOnly && !p.is_core) return false;
      if (!matchesSearch(p, query)) return false;
      return true;
    });
  }, [data, query, coreOnly]);

  const coreCount = useMemo(
    () => (data ? data.items.filter((p) => p.is_core).length : 0),
    [data],
  );

  return (
    <div className={styles.page}>
      <TrainingOverview data={overview} isLoading={overviewLoading} error={overviewError} />

      <section className={styles.library}>
        <header className={styles.head}>
          <div>
            <h2 className={styles.title}>题库探索</h2>
            <p className={styles.subtitle}>
              {isLoading
                ? "正在加载题库"
                : error
                  ? "题库加载失败，可以刷新后重试"
                  : `${filtered.length} / ${data?.total ?? 0} 道题`}
            </p>
          </div>
          <div className={styles.toolbar}>
            <SearchBar value={query} onChange={setQuery} />
            <CoreFilterToggle value={coreOnly} onChange={setCoreOnly} count={coreCount} />
          </div>
        </header>

        {isLoading && <div className={styles.state}>正在加载题库……</div>}
        {error && !isLoading && (
          <div className={styles.state}>
            题库暂时没有加载成功。请确认后端正在运行，然后刷新页面。
          </div>
        )}
        {data && <ProblemListGrouped items={filtered} />}
      </section>
    </div>
  );
}
