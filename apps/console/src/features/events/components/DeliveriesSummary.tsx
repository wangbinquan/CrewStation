import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { PROJECT_PATHS } from '../../../shared/project/projectPaths';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import styles from './DeliveryRow.module.css';
import { ButtonLink } from '../../../shared/ui/navigation/ButtonLink';

const PAGE_SIZE = 50;

/** 参考面板事件段顶部一行：最近一页投递的条数与死信数，点开是运行与诊断的投递页（RFC-020 design §7）。 */
export function DeliveriesSummary({ projectId, subscription }: { readonly projectId: string; readonly subscription?: string }): ReactElement {
  const t = useT(), { space } = useProjectScope();
  const deliveries = useApiQuery([...queryKeys.deliveries(projectId), 'summary'], () => api.events.listDeliveries(projectId, { limit: PAGE_SIZE }));
  const items = deliveries.data?.items ?? [], dead = items.filter((item) => item.state === 'dead').length;
  return <p className={styles.summary}>
    <ButtonLink size="small" to={PROJECT_PATHS[space].operations} params={{ projectId }} search={{ tab: 'deliveries', subscription }}>
      {deliveries.isPending ? t('events.summary.loading') : deliveries.error ? t('events.summary.error') : t('events.summary.line', { count: items.length, dead })}
    </ButtonLink>
  </p>;
}
