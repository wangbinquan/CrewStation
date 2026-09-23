import type { TaskProfileDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useApiQuery } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import type { Translate } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { FormField } from '../../../../shared/ui/FormField';
import type { ProfileDraft } from '../../model/profileDraft';
import { splitErrorCode } from '../../model/profileDraft';
import { showsField } from '../../model/protocolFields';
import type { DraftErrors } from '../../model/stepDraft';
import { AdminField } from '../AdminField';
import styles from './ComputeEditor.module.css';

export interface ProfileLaunchSectionProps {
  readonly draft: ProfileDraft;
  readonly errors: DraftErrors;
  readonly disabled: boolean;
  readonly taskProfiles: readonly TaskProfileDto[];
  readonly taskProfilesUnavailable: boolean;
  readonly onChange: (fn: (draft: ProfileDraft) => ProfileDraft) => void;
}

/** 错误码翻译：带值的错误码（如 reservedArg|--model）把值放进文案。 */
export function profileErrorText(t: Translate, errors: DraftErrors, field: string): string | undefined {
  const code = errors[field];
  if (code === undefined) return undefined;
  const { key, value } = splitErrorCode(code);
  return t(`admin.profile.error.${key}`, value === undefined ? {} : { value });
}

/**
 * 启动配置（RFC-006 §5.1）：镜像、二进制与参数、模型、资源套餐。只显示当前协议适用的字段——
 * 不适用的字段服务端会拒绝，显示出来只会让管理员以为配置生效了。
 */
export function ProfileLaunchSection({ draft, errors, disabled, taskProfiles, taskProfilesUnavailable, onChange }: ProfileLaunchSectionProps): ReactElement {
  const t = useT(), p = draft.protocol, err = (field: string) => profileErrorText(t, errors, field);
  const images = useApiQuery(queryKeys.runtimeImages(), () => api.computeProfiles.runtimeImages(), { staleTimeMs: 60_000 });
  const base = images.data?.baseImage.reference;
  const set = (patch: Partial<ProfileDraft>) => onChange((d) => ({ ...d, ...patch }));
  return (
    <>
    <div className={styles.sub}>
      <h3>{t('admin.profile.section.launch')}</h3>
      <div className={styles.fields}>
        <div className={styles.wide}>
          <AdminField label={t('admin.profile.field.image')} value={draft.image} onChange={(image) => set({ image })} disabled={disabled} placeholder={images.data ? `${images.data.pullReference}/…` : undefined}
            hint={t('admin.profile.field.imageHint')} error={err('image')} />
          {base && draft.image.trim() !== base ? <div className={styles.toolbar}><Button size="small" disabled={disabled} onClick={() => set({ image: base })}>{t('admin.profile.field.useBaseImage')}</Button></div> : null}
        </div>
        <AdminField label={t('admin.profile.field.binaryPath')} value={draft.binaryPath} onChange={(binaryPath) => set({ binaryPath })} disabled={disabled} hint={t(`admin.profile.field.binaryPathHint.${p}`)} error={err('binaryPath')} />
        {showsField(p, 'model') ? <AdminField label={t('admin.profile.field.model')} value={draft.model} onChange={(model) => set({ model })} disabled={disabled} placeholder={t('admin.profile.field.modelPlaceholder')} hint={t('admin.profile.field.modelHint')} /> : null}
        <AdminField label={t('admin.profile.field.taskProfile')} value={draft.taskProfile} onChange={(taskProfile) => set({ taskProfile })} disabled={disabled || taskProfilesUnavailable}
          hint={t('admin.profile.field.taskProfileHint')} error={taskProfilesUnavailable ? t('admin.profile.field.taskProfileUnavailable') : undefined}
          options={[{ value: '', label: t('admin.profile.defaultTaskProfile') }, ...taskProfiles.map((profile) => ({ value: profile.id, label: `${profile.name} · CPU ${profile.cpu} · ${profile.memory}` }))]} />
      </div>
    </div>
    <div className={styles.sub}>
      <h3>{t('admin.profile.editor.advanced')}</h3>
      <p className={styles.hint}>{t('admin.profile.editor.advancedHint')}</p>
      <div className={styles.fields}>
        {showsField(p, 'extraArgs') ? (
          <div className={styles.wide}>
            <AdminField label={t('admin.profile.field.extraArgs')} value={draft.extraArgs} onChange={(extraArgs) => set({ extraArgs })} disabled={disabled} rows={3} monospace hint={t(`admin.profile.field.extraArgsHint.${p}`)} error={err('extraArgs')} />
          </div>
        ) : null}
        {showsField(p, 'configDir') ? <>
          <AdminField label={t('admin.profile.field.configDirEnv')} value={draft.configDirEnv} onChange={(configDirEnv) => set({ configDirEnv })} disabled={disabled} placeholder={p === 'claude-code' ? 'CLAUDE_CONFIG_DIR' : 'OPENCODE_CONFIG_DIR'} hint={t('admin.profile.field.configDirEnvHint')} error={err('configDirEnv')} />
          <AdminField label={t('admin.profile.field.configDirName')} value={draft.configDirName} onChange={(configDirName) => set({ configDirName })} disabled={disabled} placeholder={p === 'claude-code' ? '.claude' : '.opencode'} hint={t('admin.profile.field.configDirNameHint')} error={err('configDirName')} />
        </> : null}
        {showsField(p, 'isSandbox') ? (
          <FormField label={t('admin.profile.field.isSandbox')} hint={t('admin.profile.field.isSandboxHint')}>
            <span className={styles.checkbox}><input type="checkbox" checked={draft.isSandbox} disabled={disabled} onChange={(event) => set({ isSandbox: event.target.checked })} /> IS_SANDBOX=1</span>
          </FormField>
        ) : null}
        {showsField(p, 'opencode') ? (['variant', 'temperature', 'steps', 'maxSteps'] as const).map((key) => (
          <AdminField key={key} label={t(`admin.profile.field.opencode.${key}`)} value={draft.opencode[key]} onChange={(value) => onChange((d) => ({ ...d, opencode: { ...d.opencode, [key]: value } }))} disabled={disabled}
            inputMode={key === 'variant' ? undefined : 'numeric'} hint={key === 'variant' ? t('admin.profile.field.opencodeHint') : undefined} error={err(`opencode.${key}`)} />
        )) : null}
      </div>
    </div>
    </>
  );
}
