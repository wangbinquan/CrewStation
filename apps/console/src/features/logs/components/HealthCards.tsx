import type { HealthState, SlotName } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useDateText } from '../../../shared/lib/useDateText';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import type { BadgeTone } from '../../../shared/ui/Badge';
import styles from './HealthCards.module.css';

/** degraded 还在服务，用 warning；反复重启与不健康是已经坏了，用 danger。 */
const TONE: Readonly<Record<HealthState, BadgeTone>> = {
  healthy: 'success',
  degraded: 'warning',
  'crash-looping': 'danger',
  unhealthy: 'danger',
  unknown: 'neutral',
};

/** 两个部署槽各一块：副本、重启与最近一次状态变化。 */
export function HealthCards({ projectId, onLogs }: { readonly projectId: string; readonly onLogs?: (slot: SlotName) => void }): ReactElement {
  const t = useT();
  const dateText = useDateText();
  const health = useApiQuery(queryKeys.projectHealth(projectId), () => api.observability.health(projectId), { enabled: projectId !== '' });
  const items = health.data?.items ?? [];
  return (
    <Card title={t('logs.health.title')}>
      <QueryStatus
        isPending={health.isPending}
        error={health.error}
        isEmpty={items.length === 0}
        emptyTitle={t('logs.health.emptyTitle')}
        emptyDescription={t('logs.health.emptyDescription')}
      />
      {items.length > 0 ? (
        <div className={styles.grid}>
          {items.map((slot) => (
            <div key={slot.slot} className={styles.slot}>
              <div className={styles.head}>
                <span className={styles.name}>{t(`logs.slot.${slot.slot}`)}</span>
                <Badge tone={TONE[slot.state]}>{t(`logs.healthState.${slot.state}`)}</Badge>
              </div>
              <dl className={styles.facts}>
                <dt>{t('logs.health.replicas')}</dt>
                <dd>{`${slot.readyReplicas} / ${slot.replicas}`}</dd>
                <dt>{t('logs.health.restarts')}</dt>
                <dd>{slot.restarts}</dd>
                <dt>{t('logs.health.lastTransitionAt')}</dt>
                <dd>{dateText(slot.lastTransitionAt)}</dd>
              </dl>
              {onLogs ? <Button onClick={() => onLogs(slot.slot)}>{t('logs.health.viewLogs')}</Button> : null}
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
