import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { isInFlight } from '../model/releaseStatus';
import { useIntervalRefetch } from '../model/useIntervalRefetch';
import { DataTable } from './DataTable';
import { QueryStatus } from './QueryStatus';
import { ReleaseRow } from './ReleaseRow';
import styles from './ReleaseHistoryCard.module.css';

export function ReleaseHistoryCard({ serviceId }: { readonly serviceId: string }): ReactElement {
  const t = useT();
  const releases = useApiQuery(queryKeys.releases(serviceId), () => api.services.listReleases(serviceId));
  const items = releases.data?.items ?? [];
  const running = items.some((release) => isInFlight(release.status));
  useIntervalRefetch(running, releases.refetch);
  const headers = [
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
        <DataTable headers={headers}>
          {items.map((release) => (
            <ReleaseRow key={release.id} release={release} />
          ))}
        </DataTable>
      ) : null}
    </Card>
  );
}
