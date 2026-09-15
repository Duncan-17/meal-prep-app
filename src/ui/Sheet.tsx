/**
 * Bottom sheet.
 *
 * A phone-shaped modal: it comes up from the bottom, within thumb reach, and
 * closes on backdrop tap or Escape. Built on `<dialog>` so the browser handles
 * focus trapping and the top layer rather than this file reimplementing them.
 */

import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Sheet({ open, title, onClose, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Escape fires `cancel`; let the parent own the state either way.
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;

    function handleCancel(event: Event) {
      event.preventDefault();
      onClose();
    }

    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className="sheet"
      onClick={(event) => {
        // Clicks land on the dialog itself only when they hit the backdrop —
        // anything inside the panel stops here.
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="sheet__panel">
        <div className="sheet__head">
          <h2 className="sheet__title">{title}</h2>
          <button type="button" className="sheet__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet__body">{children}</div>
      </div>
    </dialog>
  );
}
