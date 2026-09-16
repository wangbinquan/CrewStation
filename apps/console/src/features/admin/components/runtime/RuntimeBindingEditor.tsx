import type { RuntimeDriver } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../../shared/lib/useT';
import type { DraftErrors, RuntimeDraft } from '../../model/runtimeDraft';
import { AdminField } from '../AdminField';
import styles from './RuntimeEditor.module.css';

export interface RuntimeBindingEditorProps {
  readonly driver: RuntimeDriver;
  readonly draft: RuntimeDraft;
  readonly errors: DraftErrors;
  readonly disabled: boolean;
  readonly onChange: (fn: (draft: RuntimeDraft) => RuntimeDraft) => void;
}

const KINDS: Readonly<Record<RuntimeDriver, readonly RuntimeDraft['configFileKind'][]>> = { 'claude-code': ['none', 'claude-settings'], opencode: ['none', 'opencode-config'] };

/** 配置绑定告诉平台哪一个文件是 CLI 要加载的原生配置；模型名单只限定档位可选范围。 */
export function RuntimeBindingEditor({ driver, draft, errors, disabled, onChange }: RuntimeBindingEditorProps): ReactElement {
  const t = useT();
  return (
    <div className={styles.sub}>
      <h3>{t('admin.runtime.section.binding')}</h3>
      <div className={styles.fields}>
        <div className={styles.wide}>
          <AdminField label={t('admin.runtime.binding.kind')} value={draft.configFileKind} disabled={disabled}
            onChange={(kind) => onChange((d) => ({ ...d, configFileKind: kind as RuntimeDraft['configFileKind'], configFilePath: kind === 'none' ? '' : d.configFilePath || (d.steps.find((s) => s.kind === 'file')?.pathTemplate ?? '') }))}
            options={KINDS[driver].map((kind) => ({ value: kind, label: t(`admin.runtime.binding.${kind}`) }))} />
        </div>
        {draft.configFileKind === 'none' ? null : (
          <div className={styles.wide}>
            <AdminField label={t('admin.runtime.binding.path')} value={draft.configFilePath} onChange={(configFilePath) => onChange((d) => ({ ...d, configFilePath }))} disabled={disabled}
              hint={t('admin.runtime.binding.pathHint')} error={errors.configFilePath ? t(`admin.runtime.error.${errors.configFilePath}`) : undefined} />
          </div>
        )}
        <AdminField label={t('admin.runtime.binding.defaultModel')} value={draft.defaultModel} onChange={(defaultModel) => onChange((d) => ({ ...d, defaultModel }))} disabled={disabled}
          error={errors.defaultModel ? t(`admin.runtime.error.${errors.defaultModel}`) : undefined} />
        <AdminField label={t('admin.runtime.binding.models')} value={draft.models} onChange={(models) => onChange((d) => ({ ...d, models }))} disabled={disabled} rows={4} monospace hint={t('admin.runtime.binding.modelsHint')} />
      </div>
    </div>
  );
}
