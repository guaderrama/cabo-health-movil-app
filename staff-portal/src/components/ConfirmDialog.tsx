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
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onCancelRef = useRef(props.onCancel);
  const busyRef = useRef(Boolean(props.busy));
  onCancelRef.current = props.onCancel;
  busyRef.current = Boolean(props.busy);

  useEffect(() => {
    if (!props.open) return undefined;
    previousFocus.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    cancelRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (busyRef.current) return;
        onCancelRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [],
      );
      if (controls.length === 0) {
        event.preventDefault();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus.current?.focus();
      previousFocus.current = null;
    };
  }, [props.open]);

  if (!props.open) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={props.busy ? undefined : props.onCancel}>
      <section
        ref={dialogRef}
        aria-labelledby="confirm-title"
        aria-modal="true"
        className="confirm-dialog"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p className="eyebrow">CaboHealth</p>
        <h2 id="confirm-title">{props.title}</h2>
        <div className="dialog-actions">
          <button ref={cancelRef} className="button secondary" disabled={props.busy} type="button" onClick={props.onCancel}>
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
