import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { Stack } from '../../../shared/ui/Stack';
import { CatalogSearch } from '../../../shared/ui/catalog/CatalogSearch';
import { StorageDialog } from '../components/StorageDialog';
import { StorageConfiguration } from '../components/StorageConfiguration';
import { TaskStorageList } from '../components/TaskStorageList';
import { storageBytes, storageTone } from '../model/storageValues';
import styles from '../components/Storage.module.css';

export function ProjectObjectStoragePage() { const { projectId } = useProjectScope(); return <ObjectStoragePage projectId={projectId} />; }

export function ObjectStoragePage({ projectId }: { projectId?: string }) {
  const t = useT(), [query, setQuery] = useState(''), [selected, setSelected] = useState<{ name: string; backendId: string } | { name: string; spaceId: string }>();
  const spaces = useApiQuery(['object-storage', 'spaces', projectId], () => api.objectStorage.spaces(projectId), AUTO_REFRESH);
  const visible = spaces.data?.items.filter((s) => `${s.id} ${s.serviceSlug ?? ''} ${s.serviceId}`.toLowerCase().includes(query.toLowerCase()));
  return <><PageHeader title={t('objects.title')} description={t('objects.description')} /><Stack>
    {!projectId ? <StorageConfiguration inspect={setSelected} /> : null}
    <Card title={t('objects.spaces')} stacked><CatalogSearch value={query} label={t('objects.search')} onSearch={setQuery} />
      <QueryStatus isPending={spaces.isPending} error={spaces.error} />
      {visible?.length === 0 ? <EmptyState title={query ? t('catalog.noMatches') : t('objects.empty')} description={query ? t('catalog.noMatchesHint') : t('objects.emptyHint')} /> : null}
      {visible?.length ? <DataTable columns={[t('objects.project'), t('objects.environment'), t('objects.health'), t('objects.used'), t('objects.reserved'), t('objects.capacity'), t('objects.actions')]}>{visible.map((s) => <tr key={s.id}>
        <td><Link to="/projects/$projectId" params={{ projectId: s.projectId }}>{s.serviceSlug ?? s.serviceId}</Link><span className={`${styles.code} ${styles.compact}`}>{s.id}</span></td>
        <td>{t(`objects.${s.env}`)}</td><td><Badge tone={storageTone(s.health)}>{t(`objects.${s.health}`)}</Badge></td><td>{storageBytes(s.usedBytes)}</td><td>{storageBytes(s.reservedBytes)}</td><td>{storageBytes(s.quotaBytes)}</td>
        <td><Button size="small" onClick={() => setSelected({ name: `${s.serviceSlug ?? s.id} · ${t(`objects.${s.env}`)}`, spaceId: s.id })}>{t('objects.inspect')}</Button></td>
      </tr>)}</DataTable> : null}
    </Card>
    {projectId ? <TaskStorageList key={projectId} projectId={projectId} /> : null}
  </Stack>{selected ? <StorageDialog target={selected} close={() => setSelected(undefined)} /> : null}</>;
}
