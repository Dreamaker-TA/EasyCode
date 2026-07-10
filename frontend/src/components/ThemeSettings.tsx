import { useTheme } from "@/hooks/useTheme";
import type { Theme } from "@/styles/tokens";

import styles from "./ThemeSettings.module.css";

const OPTIONS: Array<{ value: Theme; label: string; description: string }> = [
  {
    value: "light",
    label: "浅色",
    description: "暖纸底色，适合日常训练和长时间阅读。",
  },
  {
    value: "dark",
    label: "深色",
    description: "暖黑界面，保留低饱和边框和可读对比。",
  },
];

export function ThemeSettings() {
  const { theme, setTheme } = useTheme();

  return (
    <section className={styles.panel}>
      <div className={styles.copy}>
        <p className="kicker">主题</p>
        <h2 className={styles.title}>
          界面外观
        </h2>
        <p className={styles.description}>主题选择会保存在本机浏览器，刷新后继续沿用。</p>
      </div>
      <div className={styles.segmented}>
        {OPTIONS.map((option) => (
          <label
            key={option.value}
            className={`${styles.option} ${theme === option.value ? styles.optionSelected : ""}`}
          >
            <input
              className={styles.input}
              type="radio"
              name="theme"
              value={option.value}
              data-qa={`theme-radio-${option.value}`}
              checked={theme === option.value}
              onChange={() => setTheme(option.value)}
            />
            <span className={styles.optionLabel}>{option.label}</span>
            <span className={styles.optionDescription}>{option.description}</span>
          </label>
        ))}
      </div>
    </section>
  );
}
