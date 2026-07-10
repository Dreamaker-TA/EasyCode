import type { ReviewOutput, SubmissionDetail } from "@/api/types";
import type { ReviewDimension } from "@/lib/reviewDimensions";

import styles from "./ReviewDetails.module.css";

interface Props {
  submission: SubmissionDetail;
  review: ReviewOutput;
  dimensions: ReviewDimension[];
  diagnosis: string;
}

export function ReviewDetails({ submission, review, dimensions, diagnosis }: Props) {
  return (
    <section className={styles.wrap} data-qa="review-details">
      <aside className={styles.summary}>
        <div className="kicker">详细信息</div>
        <p className={styles.summaryTitle}>五维证据与评测元信息</p>
        <p className={styles.summaryBody}>{diagnosis}</p>
      </aside>
      <div className={styles.accordion}>
        <details className={styles.detail} open>
          <summary>五维深读</summary>
          <div className={styles.dimensionList}>
            {dimensions.map((dimension) => (
              <article key={dimension.key} className={styles.dimensionCard}>
                <div className={styles.dimensionHead}>
                  <span className={`${styles.toneDot} tone-${dimension.tone}`} />
                  <h2>{dimension.label}</h2>
                  <span>{dimension.value === null ? "无数据" : `${dimension.value}/100`}</span>
                </div>
                <p className={styles.dimensionSummary}>{dimension.summary}</p>
                <p className={styles.dimensionDetail}>{dimension.detail}</p>
              </article>
            ))}
          </div>
        </details>

        <details className={styles.detail}>
          <summary>执行与复杂度证据</summary>
          <div className={styles.evidenceGrid}>
            <EvidenceBlock label="编译状态" value={review.can_compile ? "编译通过" : "编译未通过"} tone={review.can_compile ? "ok" : "danger"} />
            <EvidenceBlock label="质量评分" value={review.quality ? `${review.quality.score}/10` : "缺失"} />
            <EvidenceBlock label="时间复杂度" value={review.complexity?.time || "—"} />
            <EvidenceBlock label="空间复杂度" value={review.complexity?.space || "—"} />
          </div>
          {!review.can_compile && review.compile_issues.length > 0 && (
            <ListBlock title="编译问题" items={review.compile_issues} mono />
          )}
          {review.quality?.comments && <TextBlock title="代码质量说明" body={review.quality.comments} />}
          {review.complexity?.explain && <TextBlock title="复杂度说明" body={review.complexity.explain} />}
        </details>

        <details className={styles.detail}>
          <summary>建议与过程复盘</summary>
          <ListBlock
            title="优化建议"
            items={review.optimization.length > 0 ? review.optimization : ["暂无优化建议。"]}
          />
          <TextBlock title="过程复盘" body={review.process_review || "本次未生成过程复盘。"} />
        </details>

        <details className={styles.detail}>
          <summary>测试与快照</summary>
          <div className={styles.evidenceGrid}>
            <EvidenceBlock label="提交状态" value={submission.status} />
            <EvidenceBlock label="用时" value={formatMMSS(submission.elapsed_sec)} />
            <EvidenceBlock label="快照数" value={`${submission.snapshots_count}`} />
            <EvidenceBlock label="评测尝试" value={`${submission.review_attempts}`} />
          </div>
          <TextBlock title="评级依据" body={review.rating_rationale || "本次没有额外评级依据。"} />
        </details>
      </div>
    </section>
  );
}

function EvidenceBlock({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "danger" | "neutral";
}) {
  // neutral 不套 tone 类：证据值默认保持 ink 主色，只有语气档才转 tone 前景色。
  return (
    <div className={styles.evidenceBlock}>
      <span>{label}</span>
      <strong className={tone === "neutral" ? undefined : `tone-${tone}`}>{value}</strong>
    </div>
  );
}

function TextBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className={styles.textBlock}>
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

function ListBlock({ title, items, mono = false }: { title: string; items: string[]; mono?: boolean }) {
  return (
    <div className={styles.textBlock}>
      <h2>{title}</h2>
      <ul className={mono ? styles.monoList : styles.list}>
        {items.map((item, index) => (
          <li key={`${index}-${item}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function formatMMSS(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}
