import { ObjectBackendDtoSchema, ObjectSpaceDtoSchema } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { Card } from '../../../shared/ui/Card';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { ButtonLink } from '../../../shared/ui/navigation/ButtonLink';
import { storageBytes } from '../model/storageValues';

/** 总览只读取目录摘要；详情中的指标历史、队列和对象列表按需读取。 */
export function ObjectStorageOverview() {
  const t = useT();
  const backendsQuery = useApiQuery(['object-storage', 'backends'], async () => {
    const result = ObjectBackendDtoSchema.array().safeParse((await api.objectStorage.backends()).items);
    if (!result.success) throw new Error(t('objects.overview.invalid'));
    return { items: result.data };
  }, AUTO_REFRESH);
  const spacesQuery = useApiQuery(['object-storage', 'spaces', undefined], async () => {
    const result = ObjectSpaceDtoSchema.array().safeParse((await api.objectStorage.spaces()).items);
    if (!result.success) throw new Error(t('objects.overview.invalid'));
    return { items: result.data };
  }, AUTO_REFRESH);
  // 后续刷新失败也不能继续把缓存里的健康和数量当作当前实况；另一份成功回执仍可展示。
  const backends = backendsQuery.error ? undefined : backendsQuery.data?.items;
  const spaces = spacesQuery.error ? undefined : spacesQuery.data?.items;
  const health = [...(backends?.map((b) => b.state === 'offline' ? 'unavailable' : b.health) ?? []), ...(spaces?.map((s) => s.health) ?? [])];
  const state = health.some((s) => s === 'degraded' || s === 'unavailable') ? 'attention'
    : !backends || !spaces ? 'unknown' : !backends.length ? 'unconfigured' : health.includes('unknown') ? 'unknown' : 'ready';
  const bytes = (key: 'usedBytes' | 'quotaBytes' | 'reservedBytes' | 'deletingBytes') => storageBytes(spaces ? spaces.reduce((sum, space) => sum + space[key], 0) : null);
  const ready = backends?.filter((b) => b.state !== 'offline' && b.health === 'ready').length;
  return <Card title={t('objects.overview.title')} compact stacked
    extra={<Badge tone={state === 'ready' ? 'success' : state === 'attention' ? 'warning' : 'neutral'}>{t(`objects.overview.${state}`)}</Badge>}
    actions={<ButtonLink to="/admin/object-storage">{t('objects.overview.open')}</ButtonLink>}
    footer={t('objects.overview.hint')}>
    <QueryStatus isPending={backendsQuery.isPending} error={backendsQuery.error} loadingKey="objects.overview.loadingBackends" errorKey="objects.overview.backendError" />
    <QueryStatus isPending={spacesQuery.isPending} error={spacesQuery.error} loadingKey="objects.overview.loadingSpaces" errorKey="objects.overview.spaceError" />
    <DefinitionList layout="grid" items={[
      { label: t('objects.overview.backends'), value: backends ? t('objects.overview.readyCount', { ready: ready!, total: backends.length }) : '—' },
      { label: t('objects.spaces'), value: spaces?.length ?? '—' },
      { label: t('objects.overview.used'), value: bytes('usedBytes') },
      { label: t('objects.overview.quota'), value: bytes('quotaBytes') },
      { label: t('objects.reserved'), value: bytes('reservedBytes') },
      { label: t('objects.deleting'), value: bytes('deletingBytes') },
    ]} />
  </Card>;
}
