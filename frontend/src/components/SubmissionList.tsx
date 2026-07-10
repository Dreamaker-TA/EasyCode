import type { SubmissionListItem } from "@/api/types";
import { formatLocalDateTime } from "@/lib/datetime";

import { RatingBadge } from "./RatingBadge";
import styles from "./SubmissionList.module.css";

interface Props {
  items: SubmissionListItem[];
  onSelect: (submissionId: string) => void;
  selectedId?: string | null;
  selectionMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (submissionId: string) => void;
}

function fmtMMSS(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function fmtDateTime(iso: string | null): string {
  return formatLocalDateTime(iso);
}

export function SubmissionList({
  items,
  onSelect,
  selectedId,
  selectionMode = false,
  selectedIds,
  onToggleSelect,
}: Props) {
  if (items.length === 0) {
    return <div className={styles.empty}>没有匹配的提交</div>;
  }
  return (
    <div className={styles.wrap}>
      {items.map((it) => {
        const effective =
          it.effective_rating ?? it.user_rating_override ?? it.review_rating ?? null;
        const isViewing = !selectionMode && selectedId === it.id;
        const isChecked = selectionMode && (selectedIds?.has(it.id) ?? false);
        return (
          <button
            type="button"
            className={[
              styles.row,
              isViewing ? styles.rowSelected : "",
              selectionMode ? styles.rowSelectable : "",
              isChecked ? styles.rowChecked : "",
            ]
              .filter(Boolean)
              .join(" ")}
            key={it.id}
            onClick={() => {
              if (selectionMode) {
                onToggleSelect?.(it.id);
              } else {
                onSelect(it.id);
              }
            }}
          >
            {selectionMode && (
              <span className={styles.checkboxCell}>
                <span
                  className={`${styles.checkbox} ${isChecked ? styles.checkboxOn : ""}`}
                >
                  {isChecked ? "✓" : ""}
                </span>
              </span>
            )}
            <span className={styles.timestamp}>{fmtDateTime(it.submitted_at)}</span>
            <span className={styles.elapsed}>{fmtMMSS(it.elapsed_sec)}</span>
            <span className={styles.badgeCell}>
              <RatingBadge
                effective={effective}
                userRating={it.user_rating_override}
                autoRating={it.review_rating}
                readOnly
                compact
              />
            </span>
            <span className={styles.mode}>{it.mode}</span>
          </button>
        );
      })}
    </div>
  );
}
