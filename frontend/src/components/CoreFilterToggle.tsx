import styles from "./CoreFilterToggle.module.css";

interface Props {
  value: boolean;
  onChange: (v: boolean) => void;
  count?: number;
}

export function CoreFilterToggle({ value, onChange, count }: Props) {
  return (
    <label className={`${styles.toggle} ${value ? styles.on : ""}`}>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className={styles.input}
      />
      <span className={styles.star}>★</span>
      <span className={styles.label}>仅核心题</span>
      {count !== undefined && <span className={`tnum ${styles.count}`}>{count}</span>}
    </label>
  );
}
