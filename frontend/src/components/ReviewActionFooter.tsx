import { useEffect, useRef, useState } from "react";

import type { ReviewAction, ReviewPrescription } from "@/lib/reviewActions";
import type { ReviewExportPanel } from "./ReviewExportDialog";

import { Button, type ButtonVariant } from "./Button";
import styles from "./ReviewActionFooter.module.css";

interface Props {
  actions: ReviewAction[];
  prescription?: ReviewPrescription | null;
  retryPending?: boolean;
  onContinue?: () => void;
  onRestart?: () => void;
  onRetryReview?: () => void;
  onExportReview?: (panel: ReviewExportPanel) => void;
}

export function ReviewActionFooter({
  actions,
  prescription = null,
  retryPending = false,
  onContinue,
  onRestart,
  onRetryReview,
  onExportReview,
}: Props) {
  if (actions.length === 0 && !prescription) return null;

  const primary = actions.find((action) => action.kind === "primary");
  const secondary = actions.filter((action) => action.kind === "secondary");

  return (
    <footer className={styles.footer} data-qa="review-action-footer">
      {prescription && (
        <div className={`${styles.prescription} tone-${prescription.tone}`}>
          <div>
            <p className={styles.prescriptionLabel}>训练处方</p>
            <p className={styles.prescriptionTitle}>{prescription.title}</p>
            <p className={styles.prescriptionDetail}>{prescription.detail}</p>
          </div>
          {prescription.meta && <span className={styles.prescriptionMeta}>{prescription.meta}</span>}
        </div>
      )}
      {primary && (
        <div className={styles.primarySlot}>
          <ActionControl
            action={primary}
            retryPending={retryPending}
            onContinue={onContinue}
            onRestart={onRestart}
            onRetryReview={onRetryReview}
            onExportReview={onExportReview}
          />
        </div>
      )}
      {secondary.length > 0 && (
        <div className={styles.secondaryRow}>
          {secondary.map((action) => (
            <ActionControl
              key={`${action.intent}-${action.label}`}
              action={action}
              retryPending={retryPending}
              onContinue={onContinue}
              onRestart={onRestart}
              onRetryReview={onRetryReview}
              onExportReview={onExportReview}
            />
          ))}
        </div>
      )}
    </footer>
  );
}

function ActionControl({
  action,
  retryPending,
  onContinue,
  onRestart,
  onRetryReview,
  onExportReview,
}: {
  action: ReviewAction;
  retryPending: boolean;
  onContinue?: () => void;
  onRestart?: () => void;
  onRetryReview?: () => void;
  onExportReview?: (panel: ReviewExportPanel) => void;
}) {
  const variant: ButtonVariant = action.kind === "primary" ? "primary" : "secondary";
  const disabled =
    action.disabled ||
    (action.intent === "continue" && !onContinue) ||
    (action.intent === "restart" && !onRestart) ||
    (action.intent === "retry_review" && (!onRetryReview || retryPending)) ||
    (action.intent === "export_review" && !onExportReview);

  if (action.intent === "export_review") {
    return (
      <ExportMenuButton
        action={action}
        variant={variant}
        disabled={disabled}
        onExportReview={onExportReview}
      />
    );
  }

  if (action.to && !disabled) {
    return (
      <Button
        as="link"
        to={action.to}
        state={action.state}
        variant={variant}
        size="lg"
        block
        title={action.kind === "secondary" ? action.reason : undefined}
      >
        {action.label}
      </Button>
    );
  }

  const handleClick = () => {
    if (action.intent === "continue") onContinue?.();
    else if (action.intent === "restart") onRestart?.();
    else if (action.intent === "retry_review") onRetryReview?.();
  };

  return (
    <Button
      variant={variant}
      size="lg"
      block
      onClick={handleClick}
      disabled={disabled}
      title={action.kind === "secondary" ? action.reason : undefined}
    >
      {action.intent === "retry_review" && retryPending ? "重试中…" : action.label}
    </Button>
  );
}

function ExportMenuButton({
  action,
  variant,
  disabled,
  onExportReview,
}: {
  action: ReviewAction;
  variant: ButtonVariant;
  disabled: boolean;
  onExportReview?: (panel: ReviewExportPanel) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  const pick = (panel: ReviewExportPanel) => {
    setOpen(false);
    onExportReview?.(panel);
  };

  return (
    <div className={styles.menuWrap} ref={wrapRef}>
      <Button
        variant={variant}
        size="lg"
        block
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        title={action.reason}
      >
        {action.label}
      </Button>
      {open && (
        <div data-qa="export-menu" className={styles.exportMenu}>
          <button type="button" onClick={() => pick("markdown")}>
            Markdown 报告
          </button>
          <button type="button" onClick={() => pick("share")}>
            PNG 分享卡片
          </button>
        </div>
      )}
    </div>
  );
}
