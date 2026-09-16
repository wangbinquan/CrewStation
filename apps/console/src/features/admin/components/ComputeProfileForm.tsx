import type { ComputeProfileInput } from '@crewstation/api-client';
import type { AgentDriver, ComputeProfileAdminDto, RuntimeConfigDto, TaskProfileDto } from '@crewstation/contracts';
import { RuntimeConfigIdSchema } from '@crewstation/contracts';
import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useT } from '../../../shared/lib/useT';
import { AdminField } from './AdminField';
import { AdminForm } from './AdminForm';
import { COMPUTE_DRIVERS } from '../model/computeDrivers';

export interface ComputeProfileFormProps {
  readonly onSubmit: (input: ComputeProfileInput) => void;
  readonly busy: boolean;
  readonly error?: ReactNode;
  readonly taskProfiles: readonly TaskProfileDto[];
  readonly profilesUnavailable: boolean;
  /** RFC-004：可绑定的运行环境；列表读取失败时选择器禁用但保留当前值。 */
  readonly runtimeConfigs?: readonly RuntimeConfigDto[];
  readonly runtimeUnavailable?: boolean;
  /** 编辑已有档位：名字固定，保存携带 expectedRevision，托管档位不会被旧客户端清掉绑定。 */
  readonly editing?: ComputeProfileAdminDto;
}

/** 新增或覆盖一个算力档位：档位名是业务唯一看得见的部分，driver 与 model 只留在平台侧（RFC-001）。 */
export function ComputeProfileForm({ onSubmit, busy, error, taskProfiles, profilesUnavailable, runtimeConfigs = [], runtimeUnavailable = false, editing }: ComputeProfileFormProps): ReactElement {
  const t = useT();
  const [name, setName] = useState(editing?.name ?? '');
  const [driver, setDriver] = useState<AgentDriver>(editing?.driver ?? 'claude-code');
  const [model, setModel] = useState(editing?.model ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [taskProfile, setTaskProfile] = useState(editing?.taskProfile ?? '');
  const [runtime, setRuntime] = useState(editing?.runtimeConfigId ?? '');
  const runtimeId = RuntimeConfigIdSchema.safeParse(runtime).data;
  const incomplete = name === '' || model === '' || (runtime !== '' && runtimeId === undefined);
  const candidates = runtimeConfigs.filter((config) => config.driver === driver);
  const runtimeOptions = [{ value: '', label: t('admin.compute.runtimeLegacy') }, ...candidates.map((config) => ({ value: config.id, label: `${config.name} · ${t(`admin.runtime.status.${config.status}`)}` }))];
  // 绑定的环境不在候选里（驱动切换、被删除或列表读取失败）时保留原值，让管理员看见而不是被静默清掉。
  if (runtime !== '' && !candidates.some((config) => config.id === runtime)) runtimeOptions.push({ value: runtime, label: editing?.runtime?.configName ?? runtime });
  return (
    <AdminForm
      submitLabel={t('admin.compute.submit')}
      busyLabel={t('admin.compute.submitting')}
      busy={busy}
      incomplete={incomplete}
      note={t('admin.compute.note')}
      error={error}
      onSubmit={() => onSubmit({ name, driver, model, taskProfile: taskProfile || undefined, description: description === '' ? undefined : description, ...(runtimeId === undefined ? {} : { runtimeConfigId: runtimeId }), ...(editing ? { expectedRevision: editing.revision } : {}) })}
    >
      <AdminField label={t('admin.compute.name')} value={name} onChange={setName} placeholder={t('admin.compute.namePlaceholder')} disabled={editing !== undefined} />
      <AdminField
        label={t('admin.compute.driver')}
        value={driver}
        onChange={(value) => { setDriver(value as AgentDriver); setRuntime(''); }}
        options={COMPUTE_DRIVERS.map((option) => ({ value: option, label: option }))}
      />
      <AdminField label={t('admin.compute.runtimeConfig')} value={runtime} onChange={setRuntime} options={runtimeOptions} disabled={runtimeUnavailable}
        hint={runtime === '' ? t('admin.compute.runtimeLegacyHint') : t('admin.compute.runtimeHint')} />
      <AdminField label={t('admin.compute.model')} value={model} onChange={setModel} placeholder={t('admin.compute.modelPlaceholder')} hint={runtime === '' ? undefined : t('admin.compute.modelHint')} />
      <AdminField label={t('admin.compute.taskProfile')} value={taskProfile} onChange={setTaskProfile} disabled={profilesUnavailable}
        hint={t('admin.compute.taskProfileHint')} error={profilesUnavailable ? t('admin.compute.taskProfileUnavailable') : undefined}
        options={[{ value: '', label: t('admin.compute.defaultTaskProfile') }, ...taskProfiles.map((profile) => ({ value: profile.name, label: `${profile.name} · CPU ${profile.cpu} · ${profile.memory}` }))]} />
      <AdminField label={t('admin.compute.description')} value={description} onChange={setDescription} placeholder={t('admin.compute.descriptionPlaceholder')} />
    </AdminForm>
  );
}
