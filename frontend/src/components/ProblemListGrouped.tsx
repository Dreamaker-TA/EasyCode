import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";

import type { ProblemListItem } from "@/api/types";

import { EmptyState } from "./EmptyState";
import { RatingBadge } from "./RatingBadge";
import styles from "./ProblemListGrouped.module.css";

interface Props {
  items: ProblemListItem[];
}

interface ChapterGroup {
  chapter_no: number;
  category: string;
  items: ProblemListItem[];
}

function groupByChapter(items: ProblemListItem[]): ChapterGroup[] {
  const map = new Map<number, ChapterGroup>();
  for (const it of items) {
    if (!map.has(it.chapter_no)) {
      map.set(it.chapter_no, {
        chapter_no: it.chapter_no,
        category: it.category,
        items: [],
      });
    }
    map.get(it.chapter_no)!.items.push(it);
  }
  return Array.from(map.values())
    .sort((a, b) => a.chapter_no - b.chapter_no)
    .map((g) => ({ ...g, items: g.items.slice().sort((a, b) => a.problem_no - b.problem_no) }));
}

export function ProblemListGrouped({ items }: Props) {
  const groups = useMemo(() => groupByChapter(items), [items]);
  const location = useLocation();
  const fromPath = location.pathname + location.search;

  if (groups.length === 0) {
    return (
      <EmptyState
        kicker="题库探索"
        message="没有匹配的题目。换个关键词，或清空搜索与核心筛选再看看。"
      />
    );
  }

  return (
    <div className={styles.wrap}>
      {groups.map((g) => (
        <section key={g.chapter_no} className={styles.group}>
          <header className={styles.groupHeader}>
            <span className={styles.chapterNo}>第 {String(g.chapter_no).padStart(2, "0")} 章</span>
            <span className={styles.category}>{g.category}</span>
            <span className={`tnum ${styles.groupCount}`}>{g.items.length}</span>
          </header>
          <ul className={styles.list}>
            {g.items.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/problem/${p.id}`}
                  state={{ from: fromPath }}
                  className={styles.item}
                >
                  <span className={styles.problemNo}>{String(p.problem_no).padStart(2, "0")}</span>
                  <span className={styles.id}>{p.leetcode_id ?? p.external_id ?? "—"}</span>
                  <span className={styles.title}>{p.title}</span>
                  {p.is_core && <span className={styles.core} title="核心题">★</span>}
                  {p.mastery?.effective_rating && (
                    <RatingBadge
                      effective={p.mastery.effective_rating}
                      userRating={p.mastery.user_rating}
                      autoRating={p.mastery.effective_rating}
                      readOnly
                      compact
                      title={
                        p.mastery.user_rating
                          ? `用户覆盖 → ${p.mastery.effective_rating}`
                          : `自动评级 → ${p.mastery.effective_rating}`
                      }
                    />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
