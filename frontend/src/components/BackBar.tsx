import { Button } from "./Button";
import styles from "./BackBar.module.css";

interface Props {
  label?: string;
  onBack: () => void;
}

export function BackBar({ label = "上一页", onBack }: Props) {
  return (
    <div className={styles.bar}>
      <Button variant="ghost" size="sm" onClick={onBack}>
        <span className={styles.arrow}>
          ←
        </span>
        <span>返回 {label}</span>
      </Button>
    </div>
  );
}

export function labelForPath(path: string): string {
  if (path === "/" || path.startsWith("/?")) return "题库";
  if (path.startsWith("/review")) return "待复习";
  if (path.startsWith("/history")) return "历史";
  return "上一页";
}
