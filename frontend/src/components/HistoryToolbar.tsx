import { Button } from "./Button";
import styles from "./HistoryToolbar.module.css";

export type HistoryFilter = "all" | "passed" | "failed";

interface Props {
  filter: HistoryFilter;
  onFilterChange: (f: HistoryFilter) => void;
  counts: { all: number; passed: number; failed: number };

  selectionMode: boolean;
  onToggleSelectionMode: () => void;

  selectedCount: number;
  visibleCount: number;
  allVisibleSelected: boolean;
  onSelectAllVisible: () => void;
  onDeleteSelected: () => void;
  deletePending: boolean;
}

const FILTER_DEFS: { value: HistoryFilter; label: string; key: keyof Props["counts"] }[] = [
  { value: "all", label: "全部", key: "all" },
  { value: "passed", label: "已通过 (A/B)", key: "passed" },
  { value: "failed", label: "未通过 (C/D)", key: "failed" },
];

export function HistoryToolbar({
  filter,
  onFilterChange,
  counts,
  selectionMode,
  onToggleSelectionMode,
  selectedCount,
  visibleCount,
  allVisibleSelected,
  onSelectAllVisible,
  onDeleteSelected,
  deletePending,
}: Props) {
  return (
    <div className={styles.bar}>
      <div className={styles.chips}>
        {FILTER_DEFS.map(({ value, label, key }) => {
          const active = filter === value;
          return (
            <button
              key={value}
              type="button"
              className={`${styles.chip} ${active ? styles.chipOn : ""}`}
              onClick={() => onFilterChange(value)}
              disabled={selectionMode && deletePending}
            >
              <span>{label}</span>
              <span className={styles.count}>{counts[key]}</span>
            </button>
          );
        })}
      </div>
      <div className={styles.actions}>
        {selectionMode ? (
          <>
            <span className={styles.selectedHint}>已选 {selectedCount} 条</span>
            <button
              type="button"
              className={styles.linkBtn}
              onClick={onSelectAllVisible}
              disabled={visibleCount === 0 || deletePending}
            >
              {allVisibleSelected ? "取消全选" : `全选 ${visibleCount} 条`}
            </button>
            <Button
              variant="danger"
              size="md"
              onClick={onDeleteSelected}
              disabled={selectedCount === 0 || deletePending}
            >
              {deletePending ? "删除中…" : "删除选中"}
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={onToggleSelectionMode}
              disabled={deletePending}
            >
              取消
            </Button>
          </>
        ) : (
          <Button variant="secondary" size="md" onClick={onToggleSelectionMode}>
            选择
          </Button>
        )}
      </div>
    </div>
  );
}
