import { BEFORE_START_LIMITS } from '@crewstation/contracts';
import type { ScriptLanguage } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../../shared/lib/useT';
import type { Translate } from '../../../../shared/lib/useT';
import { Badge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import type { DraftErrors, StepDraft } from '../../model/runtimeDraft';
import { SCRIPT_EXAMPLES, previewPath } from '../../model/runtimeDraft';
import { AdminField } from '../AdminField';
import styles from './RuntimeEditor.module.css';

export interface RuntimeStepEditorProps {
  readonly step: StepDraft;
  readonly index: number;
  readonly errors: DraftErrors;
  readonly disabled: boolean;
  readonly onChange: (patch: Partial<StepDraft>) => void;
}

const LANGUAGES: readonly ScriptLanguage[] = ['shell', 'python', 'javascript', 'custom'];
const TIMEOUT_VALUES = { min: String(BEFORE_START_LIMITS.minScriptTimeoutMs / 1000), max: String(BEFORE_START_LIMITS.maxScriptTimeoutMs / 1000) };

/** 错误码来自 validateDraft，这里只翻译；服务端逐字段错误由保存失败文案承接。 */
export function stepErrorText(t: Translate, errors: DraftErrors, index: number, field: string): string | undefined {
  const code = errors[`steps.${index}.${field}`];
  return code === undefined ? undefined : t(`admin.runtime.error.${code}`, TIMEOUT_VALUES);
}

export function RuntimeStepEditor({ step, index, errors, disabled, onChange }: RuntimeStepEditorProps): ReactElement {
  const t = useT();
  const err = (field: string) => stepErrorText(t, errors, index, field);
  return (
    <div className={styles.fields}>
      <AdminField label={t('admin.runtime.step.stepId')} value={step.stepId} onChange={(stepId) => onChange({ stepId })} disabled={disabled} hint={t('admin.runtime.step.stepIdHint')} error={err('stepId')} />
      <AdminField label={t('admin.runtime.step.name')} value={step.name} onChange={(name) => onChange({ name })} disabled={disabled} error={err('name')} />
      {step.kind === 'file' ? <FileFields step={step} disabled={disabled} err={err} onChange={onChange} /> : <ScriptFields step={step} disabled={disabled} err={err} onChange={onChange} />}
    </div>
  );
}

interface FieldsProps { readonly step: StepDraft; readonly disabled: boolean; readonly err: (field: string) => string | undefined; readonly onChange: (patch: Partial<StepDraft>) => void }

function FileFields({ step, disabled, err, onChange }: FieldsProps): ReactElement {
  const t = useT();
  const preview = previewPath(step.pathTemplate);
  return (
    <>
      <div className={styles.wide}>
        <AdminField label={t('admin.runtime.step.pathTemplate')} value={step.pathTemplate} onChange={(pathTemplate) => onChange({ pathTemplate })} disabled={disabled} hint={t('admin.runtime.step.pathHint')} error={err('pathTemplate')} />
        {preview.path === '' ? null : (
          <p className={styles.preview}>
            {t('admin.runtime.step.pathPreview', { path: preview.path })}{' '}
            <Badge tone={preview.scope === 'private' ? 'success' : preview.scope === 'shared' ? 'warning' : 'danger'}>{t(`admin.runtime.step.scope.${preview.scope}`)}</Badge>
          </p>
        )}
      </div>
      <AdminField label={t('admin.runtime.step.format')} value={step.format} onChange={(format) => onChange({ format: format as StepDraft['format'] })} disabled={disabled}
        options={(['text', 'json', 'jsonc'] as const).map((format) => ({ value: format, label: format }))} />
      <AdminField label={t('admin.runtime.step.mode')} value={step.mode} onChange={(mode) => onChange({ mode })} disabled={disabled} error={err('mode')} />
      <AdminField label={t('admin.runtime.step.existing')} value={step.existing} onChange={(existing) => onChange({ existing: existing as StepDraft['existing'] })} disabled={disabled}
        options={(['require-same', 'replace'] as const).map((existing) => ({ value: existing, label: t(`admin.runtime.step.existing.${existing}`) }))} />
      <div className={styles.wide}>
        <AdminField label={t('admin.runtime.step.contentTemplate')} value={step.contentTemplate} onChange={(contentTemplate) => onChange({ contentTemplate })} disabled={disabled} rows={12} monospace hint={t('admin.runtime.step.contentHint')} error={err('contentTemplate')} />
      </div>
    </>
  );
}

function ScriptFields({ step, disabled, err, onChange }: FieldsProps): ReactElement {
  const t = useT();
  return (
    <>
      <AdminField label={t('admin.runtime.step.language')} value={step.language} onChange={(language) => onChange({ language: language as ScriptLanguage })} disabled={disabled}
        options={LANGUAGES.map((language) => ({ value: language, label: t(`admin.runtime.step.language.${language}`) }))} />
      <AdminField label={t('admin.runtime.step.timeoutSeconds', TIMEOUT_VALUES)} value={step.timeoutSeconds} onChange={(timeoutSeconds) => onChange({ timeoutSeconds })} disabled={disabled} inputMode="numeric" error={err('timeoutSeconds')} />
      {step.language === 'custom' ? (
        <div className={styles.wide}>
          <AdminField label={t('admin.runtime.step.interpreter')} value={step.interpreter} onChange={(interpreter) => onChange({ interpreter })} disabled={disabled} rows={3} monospace error={err('interpreter')} />
        </div>
      ) : null}
      <div className={styles.wide}>
        <AdminField label={t('admin.runtime.step.source')} value={step.source} onChange={(source) => onChange({ source })} disabled={disabled} rows={14} monospace hint={t('admin.runtime.step.sourceHint')} error={err('source')} />
        <div className={styles.toolbar}>
          <Button variant="ghost" disabled={disabled || step.source.trim() !== ''} onClick={() => onChange({ source: SCRIPT_EXAMPLES[step.language] })}>{t('admin.runtime.step.example')}</Button>
        </div>
      </div>
      <AdminField label={t('admin.runtime.step.argv')} value={step.argv} onChange={(argv) => onChange({ argv })} disabled={disabled} rows={3} monospace />
      <AdminField label={t('admin.runtime.step.cwd')} value={step.cwdTemplate} onChange={(cwdTemplate) => onChange({ cwdTemplate })} disabled={disabled} hint={t('admin.runtime.step.cwdHint')} />
    </>
  );
}
