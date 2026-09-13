import type { ApiRequestDto, ApiRequestState } from '@crewstation/contracts';
import type { ReactElement, ReactNode } from 'react';
import { useDateText } from '../../../shared/lib/useDateText';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import type { BadgeTone } from '../../../shared/ui/Badge';
import { Card } from '../../../shared/ui/Card';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { RequestDecisionForm } from './RequestDecisionForm';
import styles from './RequestsPanel.module.css';

const STATE_TONE: Readonly<Record<ApiRequestState, BadgeTone>> = { pending: 'info', approved: 'success', rejected: 'warning' };
const STATE_KEY: Readonly<Record<ApiRequestState, string>> = {
  pending: 'catalog.requests.statePending',
  approved: 'catalog.requests.stateApproved',
  rejected: 'catalog.requests.stateRejected',
};

export interface RequestsPanelProps {
  readonly requests: readonly ApiRequestDto[];
  readonly loading: boolean;
  readonly loadError: unknown;
  readonly title?: string;
  readonly empty?: string;
  readonly renderService?: (serviceId: string) => ReactNode;
  readonly management?: { readonly busy: boolean; readonly onDecide: (id: string, approve: boolean, decision?: string) => void };
}

/** 申请事实供项目和管理页复用；只有管理入口注入审批动作。 */
export function RequestsPanel({ requests, loading, loadError, title, empty, renderService, management }: RequestsPanelProps): ReactElement {
  const t = useT();
  return (
    <Card title={title ?? t('catalog.requests.title')}>
      <QueryStatus isPending={loading} error={loadError} loadingKey="catalog.requests.loading" errorKey="catalog.error.load" />
      {!loading && loadError === null && requests.length === 0 ? <p className={styles.muted}>{empty ?? t('catalog.requests.empty')}</p> : null}
      {requests.length > 0 ? (
        <ul className={styles.list}>
          {requests.map((request) => (
            <li key={request.id} className={styles.item}>
              <div className={styles.summary}>{renderService?.(request.serviceId)}<RequestSummary request={request} /></div>
              {management && request.state === 'pending' ? (
                <RequestDecisionForm
                  pending={management.busy}
                  onDecide={(approve, decision) => management.onDecide(request.id, approve, decision)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

/** 一条申请的全部事实：谁申请、理由、状态、谁在什么时候给了什么意见。 */
function RequestSummary({ request }: { readonly request: ApiRequestDto }): ReactElement {
  const t = useT();
  const dateText = useDateText();
  return (
    <div className={styles.summary}>
      <div className={styles.head}>
        <code className={styles.key}>{request.operationKey}</code>
        <Badge tone={STATE_TONE[request.state]}>{t(STATE_KEY[request.state])}</Badge>
      </div>
      <dl className={styles.facts}>
        <dt>{t('catalog.requests.requestedBy')}</dt>
        <dd>{request.requestedBy}</dd>
        <dt>{t('catalog.requests.createdAt')}</dt>
        <dd>{dateText(request.createdAt)}</dd>
        <dt>{t('catalog.requests.reason')}</dt>
        <dd>{request.reason ?? '—'}</dd>
        {request.state === 'pending' ? null : (
          <>
            <dt>{t('catalog.requests.decidedBy')}</dt>
            <dd>{request.decidedBy ?? '—'}</dd>
            <dt>{t('catalog.requests.decidedAt')}</dt>
            <dd>{dateText(request.decidedAt)}</dd>
            <dt>{t('catalog.requests.decision')}</dt>
            <dd>{request.decision ?? '—'}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
