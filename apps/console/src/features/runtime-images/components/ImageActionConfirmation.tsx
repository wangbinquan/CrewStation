import type { ReactNode } from 'react';
import { ConfirmationDialog } from '../../../shared/ui/dialog/ConfirmationDialog';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { errorMessage } from '../../../shared/api/useApi';

export function ImageActionConfirmation({ title, target, hint, busy, error, onConfirm, onCancel, danger = true }: { readonly title: string; readonly target: ReactNode; readonly hint: string; readonly busy: boolean; readonly error: unknown; readonly onConfirm: () => void; readonly onCancel: () => void; readonly danger?: boolean }) {
  return <ConfirmationDialog title={title} question={hint} confirmLabel={title} busy={busy} danger={danger} onConfirm={onConfirm} onCancel={onCancel}>
    <div>{target}</div>{error ? <ActionNote tone="error">{errorMessage(error)}</ActionNote> : null}
  </ConfirmationDialog>;
}
