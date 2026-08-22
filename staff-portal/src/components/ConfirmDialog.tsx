import { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly busy?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (props.open) cancelRef.current?.focus();
  }, [props.open]);

  if (!props.open) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={props.onCancel}>
      <section
        aria-labelledby="confirm-title"
        aria-modal="true"
        className="confirm-dialog"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p className="eyebrow">CaboHealth</p>
        <h2 id="confirm-title">{props.title}</h2>
        <div className="dialog-actions">
          <button ref={cancelRef} className="button secondary" type="button" onClick={props.onCancel}>
            {props.cancelLabel}
          </button>
          <button className="button danger" disabled={props.busy} type="button" onClick={props.onConfirm}>
            {props.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
