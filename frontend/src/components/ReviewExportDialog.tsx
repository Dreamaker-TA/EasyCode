import { useEffect, useId, useState } from "react";

import {
  buildReviewMarkdown,
  buildReviewMarkdownFilename,
  downloadTextFile,
  type BuildReviewMarkdownInput,
} from "@/lib/reviewExportMarkdown";
import {
  buildShareCardFilename,
  canvasToBlob,
  downloadBlob,
  renderShareCardToCanvas,
} from "@/lib/reviewShareCard";

import { Button } from "./Button";
import { Modal } from "./Modal";
import styles from "./ReviewExportDialog.module.css";

export type ReviewExportPanel = "markdown" | "share";

interface Props {
  open: boolean;
  initialPanel: ReviewExportPanel;
  input: BuildReviewMarkdownInput;
  onClose: () => void;
}

export function ReviewExportDialog({
  open,
  initialPanel,
  input,
  onClose,
}: Props) {
  const titleId = useId();
  const [panel, setPanel] = useState<ReviewExportPanel>(initialPanel);
  const [includeCode, setIncludeCode] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPanel(initialPanel);
    setIncludeCode(true);
    setPreviewUrl(null);
    setPreviewBlob(null);
    setGenerating(false);
    setError(null);
  }, [initialPanel, open]);

  // 进入「分享卡片」即自动出图，不让用户多点一步「生成预览」。
  // 守卫：已有预览不重复生成；出错后停手（由「重试」按钮显式重来），避免死循环。
  useEffect(() => {
    if (open && panel === "share" && !previewUrl && !generating && !error) {
      void handleGenerateShareCard();
    }
    // handleGenerateShareCard 每次渲染重建、只读最新 input，无需入依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, panel, previewUrl, generating, error]);

  const handleDownloadMarkdown = () => {
    const markdown = buildReviewMarkdown(input, { includeCode });
    downloadTextFile(
      buildReviewMarkdownFilename(input.exportInfo),
      markdown,
      "text/markdown;charset=utf-8",
    );
  };

  const handleGenerateShareCard = async () => {
    setGenerating(true);
    setError(null);
    try {
      const canvas = document.createElement("canvas");
      await renderShareCardToCanvas(canvas, {
        exportInfo: input.exportInfo,
        submission: {
          language: input.submission.language,
          createdAt: input.submission.created_at,
          submittedAt: input.submission.submitted_at,
          reviewedAt: input.submission.reviewed_at,
        },
        dimensions: input.dimensions,
        diagnosis: input.diagnosis,
        effectiveRating: input.effectiveRating,
      });
      setPreviewUrl(canvas.toDataURL("image/png"));
      setPreviewBlob(await canvasToBlob(canvas));
    } catch (err) {
      setError(err instanceof Error ? err.message : "分享卡片生成失败。");
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadShareCard = () => {
    if (!previewBlob) return;
    downloadBlob(buildShareCardFilename(input.exportInfo), previewBlob);
  };

  return (
    <Modal
      open={open}
      titleId={titleId}
      data-qa="review-export-dialog"
      onClose={onClose}
      contentClassName={styles.dialog}
    >
      <header className={styles.header}>
        <div>
          <p className="kicker">导出</p>
          <h2 className={styles.title}>评测导出</h2>
        </div>
        <Button
          variant="secondary"
          size="md"
          className={styles.closeButton}
          data-qa="export-dialog-close"
          onClick={onClose}
          title="关闭导出对话框"
        >
          ×
        </Button>
      </header>

      <div className={styles.tabs}>
        <button
          type="button"
          data-active={panel === "markdown"}
          className={panel === "markdown" ? styles.tabActive : styles.tab}
          onClick={() => setPanel("markdown")}
        >
          Markdown
        </button>
        <button
          type="button"
          data-active={panel === "share"}
          className={panel === "share" ? styles.tabActive : styles.tab}
          onClick={() => setPanel("share")}
        >
          分享卡片
        </button>
      </div>

      {panel === "markdown" ? (
        <section className={styles.panel} data-qa="export-panel-markdown">
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              data-qa="export-include-code"
              checked={includeCode}
              onChange={(event) => setIncludeCode(event.currentTarget.checked)}
            />
            <span>
              <strong>携带代码</strong>
              <small>默认写入完整代码块；取消后只导出评测内容。</small>
            </span>
          </label>
          <div className={styles.actionRow}>
            <Button variant="primary" size="lg" onClick={handleDownloadMarkdown}>
              导出 Markdown
            </Button>
          </div>
        </section>
      ) : (
        <section className={styles.panel} data-qa="export-panel-share">
          <div className={styles.previewFrame} data-empty={previewUrl ? "false" : "true"}>
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="评测分享卡片预览"
                data-qa="share-card-preview"
                className={styles.previewImage}
              />
            ) : (
              <span>{error ? "预览生成失败" : "正在生成预览…"}</span>
            )}
          </div>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.actionRow}>
            {error && (
              <Button
                variant="secondary"
                size="lg"
                onClick={handleGenerateShareCard}
                disabled={generating}
              >
                {generating ? "正在生成…" : "重试"}
              </Button>
            )}
            <Button
              variant="primary"
              size="lg"
              onClick={handleDownloadShareCard}
              disabled={!previewBlob}
            >
              保存 PNG
            </Button>
          </div>
        </section>
      )}
    </Modal>
  );
}
