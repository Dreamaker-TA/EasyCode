import { useIoFormat, type IoFormat } from "@/hooks/useIoFormat";

import styles from "./ThemeSettings.module.css";

const OPTIONS: Array<{ value: IoFormat; label: string; description: string }> = [
  {
    value: "leetcode",
    label: "LeetCode 函数",
    description: "编辑器预填函数框架和输入输出外壳，你只写函数体（仅对已支持的题目）。",
  },
  {
    value: "acm",
    label: "ACM 输入输出",
    description: "编辑器留空，你自己从标准输入读取、用 print 输出。",
  },
];

export function AnswerFormatSettings() {
  const { ioFormat, setIoFormat } = useIoFormat();

  return (
    <section className={styles.panel}>
      <div className={styles.copy}>
        <p className="kicker">作答</p>
        <h2 className={styles.title}>
          默认输入输出格式
        </h2>
        <p className={styles.description}>
          这是新开一局时的默认起始模板；开题时仍可按次切换。判题始终按 ACM（读入 / 输出）执行。
        </p>
      </div>
      <div className={styles.segmented}>
        {OPTIONS.map((option) => (
          <label
            key={option.value}
            className={`${styles.option} ${ioFormat === option.value ? styles.optionSelected : ""}`}
          >
            <input
              className={styles.input}
              type="radio"
              name="io-format"
              value={option.value}
              checked={ioFormat === option.value}
              onChange={() => setIoFormat(option.value)}
            />
            <span className={styles.optionLabel}>{option.label}</span>
            <span className={styles.optionDescription}>{option.description}</span>
          </label>
        ))}
      </div>
    </section>
  );
}
