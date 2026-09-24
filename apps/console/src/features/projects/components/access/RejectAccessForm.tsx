import type { AppAccessRequestDto } from '@crewstation/contracts';
import { useEffect, useId, useState } from 'react';
import type { ReactElement } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { FormField } from '../../../../shared/ui/FormField';
import { FormDialog } from '../../../../shared/ui/dialog/FormDialog';

interface RejectAccessFormProps {
  readonly request: AppAccessRequestDto;
  /** 弹窗开着；关着时组件仍挂载，理由草稿留着（2026-09-23 裁定：关窗不丢草稿）。 */
  readonly open: boolean;
  readonly busy: boolean;
  readonly error?: string;
  readonly onDirtyChange: (dirty: boolean) => void;
  readonly onClose: () => void;
  readonly onClear: () => void;
  readonly onSubmit: (decision: string | undefined) => void;
}

/** 拒绝一条使用申请：理由可选，最多 500 字，申请人在申请页看得到。 */
export function RejectAccessForm({ request, open, busy, error, onDirtyChange, onClose, onClear, onSubmit }: RejectAccessFormProps): ReactElement | null {
  const t = useT(), id = useId(), [value, setValue] = useState(''), [submitted, setSubmitted] = useState(false);
  useEffect(() => { onDirtyChange(value.length > 0); }, [value, onDirtyChange]);
  const tooLong = value.trim().length > 500, invalid = submitted && tooLong;
  if (!open) return null;
  return <FormDialog title={t('projects.access.rejectFor', { name: request.requestedByName ?? request.requestedBy })} submitLabel={t('projects.access.reject')} busy={busy}
    error={error} dirty={value.length > 0} onClear={onClear} onClose={onClose} onSubmit={() => { setSubmitted(true); if (!tooLong) onSubmit(value.trim() || undefined); }}>
    <FormField label={t('projects.access.decision')} hint={t('projects.access.decisionHint')} hintId={`${id}-hint`} error={invalid ? t('projects.access.decisionTooLong') : undefined} errorId={`${id}-error`}>
      <textarea rows={3} value={value} disabled={busy} aria-invalid={invalid} aria-describedby={`${id}-hint`} aria-errormessage={invalid ? `${id}-error` : undefined} onChange={(event) => setValue(event.target.value)} />
    </FormField>
  </FormDialog>;
}
