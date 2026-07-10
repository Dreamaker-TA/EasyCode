import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { listProblemHistory } from "@/api/history";
import { getGrowthStats } from "@/api/stats";
import type { HistoryListItem } from "@/api/types";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { ErrorNotice } from "@/components/ErrorNotice";
import { GrowthSummary } from "@/components/GrowthSummary";
import { RatingBadge } from "@/components/RatingBadge";
import { SearchBar } from "@/components/SearchBar";
import { SkeletonLines } from "@/components/Skeleton";
import { formatLocalDateStamp, parseBackendDateTime } from "@/lib/datetime";
import { toAppError } from "@/lib/errors";

import styles from "./HistoryListPage.module.css";

/** 历史列表每页条数（客户端分页）。 */
const PAGE_SIZE = 20;

function relativeTime(iso: string): string {
  const now = Date.now();
  const date = parseBackendDateTime(iso);
  if (!date) return iso;
  const t = date.getTime();
  const diffSec = Math.max(0, Math.floor((now - t) / 1000));
  if (diffSec < 60) return "刚刚";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  if (diffSec < 86_400) return `${Math.floor(diffSec / 3600)} 小时前`;
  if (diffSec < 86_400 * 7) return `${Math.floor(diffSec / 86_400)} 天前`;
  return formatLocalDateStamp(date);
}

export function HistoryListPage() {
  const history = useQuery({
    queryKey: ["history-list"],
    // 后端 limit 上限 200；题库共约 160 题，一次取满即可全量客户端分页/搜索。
    queryFn: () => listProblemHistory({ limit: 200 }),
    staleTime: 30_000,
  });
  const growth = useQuery({
    queryKey: ["growth-stats", 7],
    queryFn: () => getGrowthStats(7),
    staleTime: 30_000,
  });

  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const items = history.data?.items ?? [];

  // 客户端过滤：按标题、分类或章题编号匹配，大小写不敏感。
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      const haystack = [
        it.title,
        it.category,
        `第 ${it.chapter_no} 章`,
        `第 ${it.problem_no} 题`,
        `${it.chapter_no}-${it.problem_no}`,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [items, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pagedItems = useMemo(
    () => filtered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE),
    [filtered, currentPage],
  );

  // 搜索变化 → 回到第一页；过滤后页码越界 → 收敛到最后一页。
  useEffect(() => {
    setPage(0);
  }, [query]);
  useEffect(() => {
    if (page > pageCount - 1) setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);

  if (history.isLoading || growth.isLoading) {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>历史</h1>
        <SkeletonLines rows={2} />
        <SkeletonLines rows={4} />
      </div>
    );
  }
  if (history.error || growth.error) {
    const err = history.error ?? growth.error;
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>历史</h1>
        <ErrorNotice
          error={toAppError(err, {
            title: "历史没有加载成功",
            message: "请确认后端正在运行；如果刚删除记录或重新导入题库，请刷新后再试。",
          })}
          variant="panel"
        />
      </div>
    );
  }
  if (!history.data || !growth.data || history.data.items.length === 0) {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>历史</h1>
        <EmptyState
          kicker="历史"
          message="还没有任何已提交的题目。完成第一局后，这里会显示练习趋势和复盘线索。"
          action={{ label: "去题库开始第一局", to: "/" }}
        />
        {growth.data && <GrowthSummary stats={growth.data} />}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>历史</h1>
      <p className={styles.subtitle}>
        共 <span className="tnum">{history.data.total}</span> 道题已练过 · 最近反馈、重复提交和薄弱点会在这里汇总
      </p>
      <GrowthSummary stats={growth.data} />
      <div className={styles.searchRow}>
        <SearchBar value={query} onChange={setQuery} placeholder="按题目 / 分类过滤" />
      </div>
      {filtered.length === 0 ? (
        <EmptyState
          kicker="历史"
          message={`没有匹配「${query.trim()}」的题目。换个题目名或分类关键词再试。`}
          action={{ label: "清除搜索", onClick: () => setQuery("") }}
        />
      ) : (
        <>
          <div className={styles.list} data-qa="history-list">
            {pagedItems.map((it) => (
              <Row key={it.problem_id} item={it} />
            ))}
          </div>
          {pageCount > 1 && (
            <nav className={styles.pager} data-qa="history-list-pager">
              <Button
                variant="secondary"
                size="md"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={currentPage === 0}
              >
                ← 上一页
              </Button>
              <span className={styles.pagerStatus}>
                第 <span className="tnum">{currentPage + 1}</span> /{" "}
                <span className="tnum">{pageCount}</span> 页 · 共{" "}
                <span className="tnum">{filtered.length}</span> 道题
              </span>
              <Button
                variant="secondary"
                size="md"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={currentPage >= pageCount - 1}
              >
                下一页 →
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

function Row({ item }: { item: HistoryListItem }) {
  return (
    <Link to={`/history/${item.problem_id}`} className={styles.row}>
      <div className={styles.titleCol}>
        <span className={styles.titleMain}>
          {item.is_core && <span className={styles.core}>★</span>}
          {item.title}
        </span>
        <span className={styles.titleMeta}>
          {item.category} · 第 {item.chapter_no} 章 · 第 {item.problem_no} 题
        </span>
        <span className={styles.summaryText}>
          {item.latest_summary ?? "最近一次评测没有留下可用摘要。"}
        </span>
      </div>
      <div className={styles.badgeCell}>
        <RatingBadge
          effective={item.latest_rating}
          userRating={null}
          autoRating={item.latest_rating}
          readOnly
          compact
        />
      </div>
      <div
        className={
          item.submissions_count >= 3
            ? `tnum ${styles.countCol} ${styles.retried}`
            : `tnum ${styles.countCol}`
        }
      >
        ×{item.submissions_count}
      </div>
      <div className={styles.timeCol}>{relativeTime(item.latest_submitted_at)}</div>
    </Link>
  );
}
