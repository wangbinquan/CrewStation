import type { EgressRequestDto, EgressRequestState } from '@crewstation/contracts';
import { useId, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { FormField } from '../../../shared/ui/FormField';
import type { BadgeTone } from '../../../shared/ui/Badge';
import styles from './EgressRequestRow.module.css';

const TONE: Readonly<Record<EgressRequestState, BadgeTone>> = { pending: 'warning', approved: 'success', rejected: 'neutral' };

export interface EgressRequestRowProps {
  readonly request: EgressRequestDto;
  readonly busy: boolean;
  readonly decision: string;
  readonly onDecisionChange: (value: string) => void;
  readonly projectLabel?: string;
  readonly projectLink?: ReactNode;
  readonly onDecide: (id: string, approve: boolean, decision: string) => void;
}

/** 裁定理由在首次显示时说明约束；无效提交逐字段反馈，服务错误保留输入。 */
export function EgressRequestRow({ request, busy, decision, onDecisionChange, projectLabel, projectLink, onDecide }: EgressRequestRowProps): ReactElement {
  const t = useT();
  const [submitted, setSubmitted] = useState(false), id = useId();
  const valid = decision.trim().length > 0 && decision.trim().length <= 500;
  const send = (approve: boolean) => { setSubmitted(true); if (valid && !busy) onDecide(request.id, approve, decision.trim()); };
  return (
    <tr>
      <td>
        <code>{request.fqdn}</code>
      </td>
      <td>
        {projectLabel ? <p>{projectLabel}</p> : null}<code>{request.projectId}</code>{projectLink ? <p>{projectLink}</p> : null}
      </td>
      <td>{request.reason ?? t('admin.none')}</td>
      <td>
        <Badge tone={TONE[request.state]}>{t(`admin.egressRequestState.${request.state}`)}</Badge>
      </td>
      <td>{request.decision ?? t('admin.none')}</td>
      <td>
        {request.state !== 'pending' ? (
          t('admin.none')
        ) : (
          <div className={styles.decide}>
            <FormField label={t('admin.egressRequests.decision')} hint={t('admin.egressRequests.decisionHint')} hintId={`${id}-hint`}
              error={submitted && !valid ? t('admin.egressRequests.decisionInvalid') : undefined} errorId={`${id}-error`}><input
              value={decision}
              disabled={busy} aria-invalid={submitted && !valid} aria-describedby={`${id}-hint`} aria-errormessage={submitted && !valid ? `${id}-error` : undefined}
              placeholder={t('admin.egressRequests.decisionPlaceholder')}
              onChange={(event) => onDecisionChange(event.target.value)}
            /></FormField>
            <Button variant="primary" disabled={busy} onClick={() => send(true)}>
              {busy ? t('admin.egressRequests.deciding') : t('admin.egressRequests.approve')}
            </Button>
            <Button disabled={busy} onClick={() => send(false)}>
              {t('admin.egressRequests.reject')}
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}
