import type { ReactElement } from 'react';
import { useT } from '../../../../shared/lib/useT';
import type { ProfileDraft } from '../../model/profileDraft';
import { configFileKindFor } from '../../model/protocolFields';
import type { DraftErrors } from '../../model/stepDraft';
import { AdminField } from '../AdminField';
import styles from './ComputeEditor.module.css';
import { profileErrorText } from './ProfileLaunchSection';

interface SectionProps {
  readonly draft: ProfileDraft;
  readonly errors: DraftErrors;
  readonly disabled: boolean;
  readonly onChange: (fn: (draft: ProfileDraft) => ProfileDraft) => void;
}

/**
 * 两种已知协议：哪一个文件是 CLI 要加载的原生配置（Claude settings.json 经唯一的 --settings 传入，
 * OpenCode 配置经 OPENCODE_CONFIG 指定）；平台的 MCP 身份与观测叠加在上面，不覆盖管理员内容。
 */
export function ConfigFileSection({ draft, errors, disabled, onChange }: SectionProps): ReactElement | null {
  const t = useT();
  const kind = configFileKindFor(draft.protocol);
  if (!kind) return null;
  return (
    <div className={styles.sub}>
      <h3>{t('admin.profile.section.configFile')}</h3>
      <div className={styles.fields}>
        <div className={styles.wide}>
          <AdminField label={t('admin.profile.configFile.kind')} value={draft.configFileKind === 'none' ? 'none' : kind} disabled={disabled}
            onChange={(value) => onChange((d) => ({ ...d, configFileKind: value === 'none' ? 'none' : kind, configFilePath: value === 'none' ? '' : d.configFilePath || (d.steps.find((s) => s.kind === 'file')?.pathTemplate ?? '') }))}
            options={[{ value: 'none', label: t('admin.profile.configFile.none') }, { value: kind, label: t(`admin.profile.configFile.${kind}`) }]} />
        </div>
        {draft.configFileKind === 'none' ? null : (
          <div className={styles.wide}>
            <AdminField label={t('admin.profile.configFile.path')} value={draft.configFilePath} onChange={(configFilePath) => onChange((d) => ({ ...d, configFilePath }))} disabled={disabled}
              hint={t('admin.profile.configFile.pathHint')} error={profileErrorText(t, errors, 'configFilePath')} />
          </div>
        )}
      </div>
    </div>
  );
}

/** 通用终端协议（C11）：平台解析不了它的输出，由管理员给一条测试命令与期望输出正则；输出匹配才算通过。 */
export function TerminalTestSection({ draft, errors, disabled, onChange }: SectionProps): ReactElement | null {
  const t = useT();
  if (draft.protocol !== 'terminal') return null;
  return (
    <div className={styles.sub}>
      <h3>{t('admin.profile.section.terminalTest')}</h3>
      <p className={styles.hint}>{t('admin.profile.terminalTest.hint')}</p>
      <div className={styles.fields}>
        <div className={styles.wide}>
          <AdminField label={t('admin.profile.terminalTest.command')} value={draft.testCommand} onChange={(testCommand) => onChange((d) => ({ ...d, testCommand }))} disabled={disabled} rows={3} monospace
            placeholder={'/opt/my-cli/bin/my-cli\n--version'} hint={t('admin.profile.terminalTest.commandHint')} error={profileErrorText(t, errors, 'testCommand')} />
        </div>
        <AdminField label={t('admin.profile.terminalTest.expect')} value={draft.testExpect} onChange={(testExpect) => onChange((d) => ({ ...d, testExpect }))} disabled={disabled}
          placeholder="^my-cli \d+\." hint={t('admin.profile.terminalTest.expectHint')} error={profileErrorText(t, errors, 'testExpect')} />
        <AdminField label={t('admin.profile.terminalTest.timeout')} value={draft.testTimeoutSeconds} onChange={(testTimeoutSeconds) => onChange((d) => ({ ...d, testTimeoutSeconds }))} disabled={disabled}
          inputMode="numeric" error={profileErrorText(t, errors, 'testTimeoutSeconds')} />
      </div>
    </div>
  );
}
