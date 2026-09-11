import type { EgressRequestDto, EgressRequestState } from '@crewstation/contracts';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import type { BadgeTone } from '../../../shared/ui/Badge';
import styles from './EgressRequestRow.module.css';

const TONE: Readonly<Record<EgressRequestState, BadgeTone>> = { pending: 'warning', approved: 'success', rejected: 'neutral' };

export interface EgressRequestRowProps {
  readonly request: EgressRequestDto;
  readonly busy: boolean;
  readonly onDecide: (id: string, approve: boolean, decision: string) => void;
}

/** 一条放行申请；裁定理由是必填的，所以理由为空时两个按钮都禁用。 */
export function EgressRequestRow({ request, busy, onDecide }: EgressRequestRowProps): ReactElement {
  const t = useT();
  const [decision, setDecision] = useState('');
  const ready = decision.trim() !== '' && !busy;
  return (
    <tr>
      <td>
        <code>{request.fqdn}</code>
      </td>
      <td>
        <code>{request.projectId}</code>
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
            <input
              className={styles.reason}
              value={decision}
              placeholder={t('admin.egressRequests.decisionPlaceholder')}
              onChange={(event) => setDecision(event.target.value)}
            />
            <Button variant="primary" disabled={!ready} onClick={() => onDecide(request.id, true, decision.trim())}>
              {busy ? t('admin.egressRequests.deciding') : t('admin.egressRequests.approve')}
            </Button>
            <Button disabled={!ready} onClick={() => onDecide(request.id, false, decision.trim())}>
              {t('admin.egressRequests.reject')}
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}
