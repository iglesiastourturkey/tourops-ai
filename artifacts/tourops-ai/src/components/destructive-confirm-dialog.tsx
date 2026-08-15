import { useEffect, useState, type ReactNode } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertTriangle } from 'lucide-react';

/**
 * Confirmation for permanent deletion.
 *
 * The second step is deliberate: a single "are you sure" is answered reflexively,
 * and there is no undo behind this one — no archived state, no restore. The
 * acknowledgement checkbox forces the warning to be read before the destructive
 * button becomes usable, and it resets every time the dialog opens so a previous
 * confirmation is never inherited by the next record.
 */
export function DestructiveConfirmDialog({
  open, onOpenChange, title, description, consequences, confirmLabel = 'Kalıcı Olarak Sil',
  acknowledgeLabel = 'Bu işlemin geri alınamayacağını anlıyorum', extra, pending = false, onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  /** What exactly disappears. Listed, not summarised — the user is deciding. */
  consequences?: ReactNode[];
  confirmLabel?: string;
  acknowledgeLabel?: string;
  /** Optional extra control rendered above the acknowledgement (e.g. a scope option). */
  extra?: ReactNode;
  pending?: boolean;
  onConfirm: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => { if (open) setAcknowledged(false); }, [open]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-h-[85vh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />{title}
          </AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {consequences?.length ? (
          <ul className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 space-y-1 text-sm">
            {consequences.map((line, index) => (
              <li key={index} className="flex gap-2"><span aria-hidden>•</span><span className="min-w-0">{line}</span></li>
            ))}
          </ul>
        ) : null}
        {extra}
        <label className="flex items-start gap-2.5 text-sm cursor-pointer">
          <Checkbox
            checked={acknowledged}
            onCheckedChange={checked => setAcknowledged(checked === true)}
            className="mt-0.5"
            data-testid="checkbox-acknowledge-delete"
          />
          <span>{acknowledgeLabel}</span>
        </label>
        <AlertDialogFooter>
          <AlertDialogCancel>Vazgeç</AlertDialogCancel>
          {/* Not an AlertDialogAction: that closes the dialog on click even when
              the action is disabled-by-intent, and the confirmation state has to
              survive until the request is actually sent. */}
          <button
            type="button"
            disabled={!acknowledged || pending}
            onClick={onConfirm}
            data-testid="button-confirm-delete"
            className="inline-flex items-center justify-center rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:pointer-events-none disabled:opacity-50"
          >
            {pending ? 'Siliniyor...' : confirmLabel}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
