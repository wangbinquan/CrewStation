import { SaveDevelopmentRuntimeImagesSchema } from '@crewstation/contracts';
import { useId } from 'react';
import { api } from '../api/client';
import { AUTO_REFRESH, useApiQuery } from '../api/useApi';
import { useT } from '../lib/useT';
import { QueryStatus } from '../ui/QueryStatus';
import { RuntimeImageOption } from './RuntimeImageOption';
import styles from './RuntimeImagePicker.module.css';

/** 每个启动位置只列自己的允许集合；空值交给后端解析当前位置默认，绝不从父任务继承。 */
export function RuntimeImagePicker({ projectId, profileId, usage, value, onChange, disabled = false }: {
  readonly projectId: string; readonly profileId?: string; readonly usage: 'task' | 'agent';
  readonly value: string; readonly onChange: (value: string) => void; readonly disabled?: boolean;
}) {
  const t = useT(), id = useId();
  const policy = useApiQuery(['runtime-images', projectId, 'development'], async () => {
    const data = await api.runtimeImages.development(projectId);
    SaveDevelopmentRuntimeImagesSchema.parse({ expectedRevision: data.revision, developmentTask: data.developmentTask, developmentAgents: data.developmentAgents });
    return data;
  }, AUTO_REFRESH);
  const selection = usage === 'task' ? policy.data?.developmentTask : policy.data?.developmentAgents.find((entry) => entry.profileId === profileId)?.selection;
  const ids = [...new Set([selection?.runtimeImageVersionId, ...(selection?.allowedRuntimeImageVersionIds ?? [])].filter((entry): entry is string => !!entry))];
  return <div className={styles.field}>
    <label htmlFor={id}>{t('runtimeImages.picker.label')}</label>
    <select id={id} value={value} disabled={disabled || policy.isPending || !!policy.error} onChange={(event) => onChange(event.target.value)}>
      {!policy.error && selection?.runtimeImageVersionId ? <RuntimeImageOption projectId={projectId} versionId={selection.runtimeImageVersionId} defaultOption /> : <option value="">{t(!policy.data || policy.error ? 'runtimeImages.picker.unknown' : 'runtimeImages.picker.platform')}</option>}
      {value && !ids.includes(value) ? <option value={value}>{t('runtimeImages.picker.unavailable', { version: value })}</option> : null}
      {ids.map((version) => <RuntimeImageOption key={version} projectId={projectId} versionId={version} />)}
    </select>
    <small>{t(usage === 'task' ? 'runtimeImages.picker.task' : 'runtimeImages.picker.agent')}</small>
    {policy.error ? <QueryStatus isPending={false} error={policy.error} /> : null}
  </div>;
}
