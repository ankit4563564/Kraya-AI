import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

interface ModalDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/**
 * Native <dialog> modal following modern-web-guidance `dialog`:
 * - Opened via showModal() (native focus containment, Esc handling, inert page, focus return).
 * - Omits redundant role="dialog" / aria-modal.
 * - Resets dialog.returnValue on close to prevent stale values leaking.
 */
export function ModalDialog({ open, onClose, title, children, footer }: ModalDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  const handleClose = () => {
    const el = ref.current;
    if (el) el.returnValue = '';
    onClose();
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={handleClose}
      onCancel={(e) => {
        e.preventDefault();
        handleClose();
      }}
    >
      <div className="dialog-head">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="btn btn-sm btn-icon"
          onClick={handleClose}
          aria-label="Close dialog"
        >
          <X size={15} />
        </button>
      </div>
      <div className="dialog-body">{children}</div>
      {footer && <div className="dialog-foot">{footer}</div>}
    </dialog>
  );
}
