import type { HealthState } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { formatDateTime } from '../../../shared/lib/dateFormat';
import { useI18n } from '../../../shared/lib/useI18n';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { Card } from '../../../shared/ui/Card';
import type { BadgeTone } from '../../../shared/ui/Badge';
import { QueryStatus } from './QueryStatus';
import styles from './HealthCards.module.css';

/** 主题只有 warning 一档告警色，三种不健康状态共用它，靠文案区分。 */
const TONE: Readonly<Record<HealthState, BadgeTone>> = {
  healthy: 'success',
  degraded: 'warning',
  'crash-looping': 'warning',
  unhealthy: 'warning',
  unknown: 'neutral',
};

/** 两个部署槽各一块：副本、重启与最近一次状态变化。 */
export function HealthCards({ projectId }: { readonly projectId: string }): ReactElement {
  const t = useT();
  const { locale } = useI18n();
  // queryKeys.health 的形参名叫 serviceId，但路由是 /v1/projects/:projectId/health，这里按项目取。
  const health = useApiQuery(queryKeys.health(projectId), () => api.observability.health(projectId), { enabled: projectId !== '' });
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
                <span className={styles.name}>{slot.slot}</span>
                <Badge tone={TONE[slot.state]}>{t(`logs.healthState.${slot.state}`)}</Badge>
              </div>
              <dl className={styles.facts}>
                <dt>{t('logs.health.replicas')}</dt>
                <dd>{`${slot.readyReplicas} / ${slot.replicas}`}</dd>
                <dt>{t('logs.health.restarts')}</dt>
                <dd>{slot.restarts}</dd>
                <dt>{t('logs.health.lastTransitionAt')}</dt>
                <dd>{formatDateTime(slot.lastTransitionAt, locale)}</dd>
              </dl>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
