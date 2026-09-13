import type { ReactElement } from 'react';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import type { OperationsSearch } from '../../../shared/project/operationsSearch';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { LogFilters } from '../components/LogFilters';
import { LogList } from '../components/LogList';
import { useLogFeed } from '../hooks/useLogFeed';
import styles from './LogsPage.module.css';

export function LogsPage({ filters, changeFilters }: { readonly filters: OperationsSearch; readonly changeFilters: (next: OperationsSearch) => void }): ReactElement {
  const t = useT();
  const { projectId } = useProjectScope();
  const feed = useLogFeed(projectId, filters, changeFilters);
  // 整页为空与「关键字把这一页全过滤掉了」是两回事，空态文案要分开。
  const noData = feed.total === 0;
  return (
    <>
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
