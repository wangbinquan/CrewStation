import { RuntimeImageOptionDtoSchema } from '@crewstation/contracts';
import { api } from '../api/client';
import { AUTO_REFRESH, useApiQuery } from '../api/useApi';
import { useT } from '../lib/useT';

/** 标签查询失败仍显示所选 ID，不能悄悄换成默认镜像。权限与可用性由启动准入重新裁定。 */
export function RuntimeImageOption({ projectId, versionId, defaultOption = false }: { readonly projectId: string; readonly versionId: string; readonly defaultOption?: boolean }) {
  const t = useT();
  const detail = useApiQuery(['runtime-images', projectId, 'version', versionId], async () => RuntimeImageOptionDtoSchema.parse(await api.runtimeImages.version(projectId, versionId)), AUTO_REFRESH);
  const label = detail.data ? `${detail.data.name} · ${detail.data.digest.slice(7, 19)} · …${versionId.slice(-8)}` : versionId;
  return <option value={defaultOption ? '' : versionId}>{defaultOption ? t('runtimeImages.picker.configured', { version: label }) : label}</option>;
}
