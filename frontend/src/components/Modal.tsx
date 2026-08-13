import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { useScrollLock } from "@/hooks/useScrollLock";
import { usePresence } from "@/hooks/usePresence";

import styles from "./Modal.module.css";

interface Props {
  open: boolean;
  titleId: string;
  onClose: () => void;
  children: ReactNode;
  contentClassName?: string;
  closeOnBackdrop?: boolean;
  "data-qa"?: string;
}

export function Modal({
  open,
  titleId,
  onClose,
  children,
  contentClassName,
  closeOnBackdrop = true,
  "data-qa": dataQa,
}: Props) {
  useScrollLock(open);
  const { rendered, closing } = usePresence(open, 160);

  if (!rendered) return null;

  return createPortal(
    <div
      className={`${styles.backdrop} ${closing ? styles.backdropClosing : ""}`}
      onMouseDown={() => {
        if (open && closeOnBackdrop) onClose();
      }}
    >
      <div
        className={`${styles.panel} ${closing ? styles.panelClosing : ""} ${contentClassName ?? ""}`}
        data-qa={dataQa}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
