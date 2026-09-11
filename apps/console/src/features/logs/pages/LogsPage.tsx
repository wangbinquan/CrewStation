import { useParams } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { HealthCards } from '../components/HealthCards';
import { LogFilters } from '../components/LogFilters';
import { LogList } from '../components/LogList';
import { useLogFeed } from '../hooks/useLogFeed';
import styles from './LogsPage.module.css';

export function LogsPage(): ReactElement {
  const t = useT();
  // 日志页永远挂在 /projects/$projectId 下；strict:false 与顶栏取法一致，缺参数时不发请求。
  const { projectId = '' } = useParams({ strict: false });
  const feed = useLogFeed(projectId);
  // 整页为空与「关键字把这一页全过滤掉了」是两回事，空态文案要分开。
  const noData = feed.total === 0;
  return (
    <>
      <PageHeader title={t('logs.title')} description={[t('logs.line1'), t('logs.line2')]} />
      <div className={styles.health}>
        <HealthCards projectId={projectId} />
      </div>
      <Card
        title={t('logs.list.title')}
        extra={<span className={styles.count}>{t('logs.list.count', { shown: feed.entries.length, total: feed.total })}</span>}
        footer={t('logs.list.noPagingHint')}
      >
        <LogFilters value={feed.filters} onChange={feed.changeFilters} follow={feed.follow} onFollowChange={feed.changeFollow} />
        <QueryStatus
          isPending={feed.isPending}
          error={feed.error}
          isEmpty={feed.entries.length === 0}
          emptyTitle={noData ? t('logs.list.emptyTitle') : t('logs.list.noMatchTitle')}
          emptyDescription={noData ? t('logs.list.emptyDescription') : t('logs.list.noMatchDescription')}
        />
        {feed.entries.length > 0 ? <LogList entries={feed.entries} follow={feed.follow} /> : null}
      </Card>
    </>
  );
}
