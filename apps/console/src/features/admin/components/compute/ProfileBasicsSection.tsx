import type { AgentProtocol } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../../shared/lib/useT';
import type { ProfileDraft } from '../../model/profileDraft';
import { applyPreset, withProtocol } from '../../model/profileDraft';
import type { ProfilePreset } from '../../model/profilePresets';
import { presetsFor } from '../../model/profilePresets';
import { PROTOCOLS } from '../../model/protocolFields';
import type { DraftErrors } from '../../model/stepDraft';
import { AdminField } from '../AdminField';
import styles from './ComputeEditor.module.css';
import { profileErrorText } from './ProfileLaunchSection';

export interface ProfileBasicsSectionProps {
  readonly draft: ProfileDraft;
  readonly errors: DraftErrors;
  readonly disabled: boolean;
  /** 新建可选择协议和预设；名称始终可编辑，协议建档后固定。 */
  readonly creating: boolean;
  readonly onChange: (fn: (draft: ProfileDraft) => ProfileDraft) => void;
}

/** 名称用于展示；协议建档后不可改，换协议就新建档位。 */
export function ProfileBasicsSection({ draft, errors, disabled, creating, onChange }: ProfileBasicsSectionProps): ReactElement {
  const t = useT();
  return (
    <div className={styles.sub}>
      <h3>{t('admin.profile.section.basics')}</h3>
      <div className={styles.fields}>
        <AdminField label={t('admin.profile.field.name')} value={draft.name} onChange={(name) => onChange((d) => ({ ...d, name }))} disabled={disabled}
          placeholder="claude-daily" hint={t('admin.profile.field.nameHint')} error={profileErrorText(t, errors, 'name')} />
        {creating ? <>
        <AdminField label={t('admin.profile.field.protocol')} value={draft.protocol} disabled={disabled || !creating}
          onChange={(protocol) => onChange((d) => withProtocol(d, protocol as AgentProtocol))}
          hint={creating ? t(`admin.profile.protocolHint.${draft.protocol}`) : t('admin.profile.field.protocolFixed')}
          options={PROTOCOLS.map((protocol) => ({ value: protocol, label: t(`admin.profile.protocol.${protocol}`) }))} />
        <AdminField label={t('admin.profile.visibility')} value={String(draft.defaultVisible)} disabled={disabled}
          hint={t('admin.profile.visibilityHint')} onChange={(value) => onChange((d) => ({ ...d, defaultVisible: value === 'true' }))}
          options={[{ value: 'true', label: t('admin.profile.defaultVisible') }, { value: 'false', label: t('admin.profile.defaultHidden') }]} />
        </> : null}
        {creating ? (
          <AdminField label={t('admin.profile.field.preset')} value="" disabled={disabled} hint={t('admin.profile.field.presetHint')}
            onChange={(preset) => { if (preset) onChange((d) => applyPreset(d, preset as ProfilePreset)); }}
            options={[{ value: '', label: t('admin.profile.field.presetChoose') }, ...presetsFor(draft.protocol).map((preset) => ({ value: preset, label: t(`admin.profile.preset.${preset}`) }))]} />
        ) : null}
        <div className={styles.wide}>
          <AdminField label={t('admin.profile.field.description')} value={draft.description} onChange={(description) => onChange((d) => ({ ...d, description }))} disabled={disabled}
            placeholder={t('admin.profile.field.descriptionPlaceholder')} hint={t('admin.profile.field.descriptionHint')} error={profileErrorText(t, errors, 'description')} />
        </div>
      </div>
    </div>
  );
}
