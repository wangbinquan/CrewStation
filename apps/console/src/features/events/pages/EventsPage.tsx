import { useParams } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { DeliveriesCard } from '../components/DeliveriesCard';
import { EventTypesCard } from '../components/EventTypesCard';
import { SubscriptionsCard } from '../components/SubscriptionsCard';
import styles from './EventsPage.module.css';

export function EventsPage(): ReactElement {
  const t = useT();
  // 事件页永远挂在 /projects/$projectId 下；strict:false 与顶栏取法一致，缺参数时子卡片不发请求。
  const { projectId = '' } = useParams({ strict: false });
  return (
    <>
      <PageHeader title={t('events.title')} description={[t('events.line1'), t('events.line2')]} />
      <div className={styles.columns}>
        <SubscriptionsCard projectId={projectId} />
        <EventTypesCard />
      </div>
      <DeliveriesCard projectId={projectId} />
    </>
  );
}
