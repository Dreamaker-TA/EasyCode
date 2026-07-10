import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { useScrollLock } from "@/hooks/useScrollLock";

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

  if (!open) return null;

  return createPortal(
    <div
      className={styles.backdrop}
      onMouseDown={() => {
        if (closeOnBackdrop) onClose();
      }}
    >
      <div
        className={`${styles.panel} ${contentClassName ?? ""}`}
        data-qa={dataQa}
        data-title-id={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
