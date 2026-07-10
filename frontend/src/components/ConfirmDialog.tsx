import { useId } from "react";

import { Button } from "./Button";
import { Modal } from "./Modal";
import styles from "./ConfirmDialog.module.css";

interface Props {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  variant = "default",
  loading = false,
  onConfirm,
  onCancel,
}: Props) {
  const titleId = useId();

  if (!open) return null;

  return (
    <Modal
      open={open}
      titleId={titleId}
      data-qa="confirm-dialog"
      onClose={() => {
        if (!loading) onCancel();
      }}
      closeOnBackdrop={!loading}
      contentClassName={styles.dialog}
    >
        <h2 className={styles.title}>{title}</h2>
        {description && <p className={styles.description}>{description}</p>}
        <div className={styles.actions}>
          <Button variant="secondary" size="lg" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={variant === "danger" ? "danger" : "primary"}
            size="lg"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "处理中…" : confirmLabel}
          </Button>
        </div>
    </Modal>
  );
}
