import styles from "./SearchBar.module.css";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

export function SearchBar({ value, onChange, placeholder = "搜索题目 / 编号" }: Props) {
  return (
    <div className={styles.box}>
      <span className={styles.icon}>
        ⌕
      </span>
      <input
        type="search"
        className={styles.input}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
      />
    </div>
  );
}
