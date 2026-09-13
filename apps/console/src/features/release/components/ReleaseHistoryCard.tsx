import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { usePollingRefetch } from '../../../shared/lib/usePollingRefetch';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { isInFlight } from '../model/releaseStatus';
import { ReleaseRow } from './ReleaseRow';
import styles from './ReleaseHistoryCard.module.css';

/** 构建／迁移／部署期间的轮询间隔；全部进入终态后停。 */
const IN_FLIGHT_POLL_MS = 5_000;

export function ReleaseHistoryCard({ serviceId, onSelect }: { readonly serviceId: string; readonly onSelect: (releaseId: string) => void }): ReactElement {
  const t = useT();
  const releases = useApiQuery(queryKeys.releases(serviceId), () => api.services.listReleases(serviceId));
  const items = releases.data?.items ?? [];
  const running = items.some((release) => isInFlight(release.status));
  usePollingRefetch(releases.refetch, IN_FLIGHT_POLL_MS, running);
  const columns = [
    t('release.history.columnTag'), t('release.history.columnStatus'), t('release.history.columnCommit'),
    t('release.history.columnBranch'), t('release.history.columnImage'), t('release.history.columnCreatedAt'),
  ];
  return (
    <Card title={t('release.history.title')} extra={running ? <span className={styles.polling}>{t('release.history.polling')}</span> : undefined}>
      <QueryStatus isPending={releases.isPending} error={releases.error} loadingKey="release.history.loading" errorKey="release.history.error" />
      {items.length === 0 && !releases.isPending && releases.error === null ? (
        <EmptyState title={t('release.history.empty')} description={t('release.history.emptyDescription')} />
      ) : null}
      {items.length > 0 ? (
        <DataTable columns={columns}>
          {items.map((release) => (
            <ReleaseRow key={release.id} release={release} onSelect={onSelect} />
          ))}
        </DataTable>
      ) : null}
    </Card>
  );
}
