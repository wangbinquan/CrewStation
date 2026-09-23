import type { HealthState, ResourceRecord, SlotHealthFacts, SlotName } from '@crewstation/contracts';
import { healthOfSlotRecord } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useDateText } from '../../../shared/lib/useDateText';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import type { BadgeTone } from '../../../shared/ui/Badge';
import { useProjectResources } from '../../../shared/resources/useProjectResources';
import styles from './HealthCards.module.css';

/** degraded 还在服务，用 warning；反复重启与不健康是已经坏了，用 danger。 */
const TONE: Readonly<Record<HealthState, BadgeTone>> = {
  healthy: 'success',
  degraded: 'warning',
  'crash-looping': 'danger',
  unhealthy: 'danger',
  unknown: 'neutral',
};

/** 线上在前：每个角色取它的服务槽记录，按旧健康接口的判定（G22）推导。 */
function slotHealthItems(records: readonly ResourceRecord[]): Array<SlotHealthFacts & { readonly slot: SlotName }> {
  return (['prod', 'preview'] as const).flatMap((slot) => {
    const record = records.find((entry) => entry.kind === 'service-slot' && entry.display?.['role'] === slot);
    return record ? [{ slot, ...healthOfSlotRecord(record) }] : [];
  });
}

/** 两个部署槽各一块：副本、重启与最近一次状态变化——照服务槽记录（RFC-025 第三期），随推送流更新。 */
export function HealthCards({ projectId, onLogs }: { readonly projectId: string; readonly onLogs?: (slot: SlotName) => void }): ReactElement {
  const t = useT();
  const dateText = useDateText();
  const records = useProjectResources(projectId);
  const items = slotHealthItems(records.data?.items ?? []);
  return (
    <Card title={t('logs.health.title')}>
      <QueryStatus
        isPending={records.isPending}
        error={records.error}
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
              {onLogs ? <div className={styles.actions}><Button onClick={() => onLogs(slot.slot)}>{t('logs.health.viewLogs')}</Button></div> : null}
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
