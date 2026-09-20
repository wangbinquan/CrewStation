import type { SetConfigItemInput } from '@crewstation/api-client';
import { ConfigNameSchema, type ConfigDefinitionDto } from '@crewstation/contracts';
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { FormField } from '../../../shared/ui/FormField';
import styles from './ConfigItemForm.module.css';

export interface ConfigItemDraft {
  readonly id?: string;
  readonly definitionId?: string;
  readonly bindingName?: string;
  readonly expectedVersion?: number;
  readonly name: string;
  readonly isSecret: boolean;
  /** 仅普通配置可预填；Secret 没有可读取的旧值。 */
  readonly value?: string;
}
export interface ConfigItemFormProps {
  readonly draft: ConfigItemDraft;
  readonly definitions: readonly ConfigDefinitionDto[];
  readonly envLabel: string;
  readonly pending: boolean;
  readonly disabled?: boolean;
  readonly existingNames: readonly string[];
  readonly onSubmit: (input: SetConfigItemInput & { id?: string }) => Promise<unknown>;
  readonly onReset: () => void;
  readonly onDirtyChange: (dirty: boolean) => void;
}

/** 请求成功后才清空值；失败、目录暂不可用和环境切换保留当前输入。 */
export function ConfigItemForm({ draft, envLabel, pending, disabled = false, existingNames, definitions, onSubmit, onReset, onDirtyChange }: ConfigItemFormProps): ReactElement {
  const t = useT(), id = useId(), busy = useRef(false), nameInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(draft.name), [value, setValue] = useState(draft.isSecret ? '' : draft.value ?? '');
  const [bindingName, setBindingName] = useState(draft.bindingName ?? ''), [definitionId, setDefinitionId] = useState(draft.definitionId);
  const [isSecret, setIsSecret] = useState(draft.isSecret), [nameError, setNameError] = useState<string>(), [displayError, setDisplayError] = useState<string>();
  const [baseline, setBaseline] = useState({ name: draft.name, value: draft.isSecret ? '' : draft.value ?? '', isSecret: draft.isSecret });
  const dirty = bindingName !== (draft.bindingName ?? '') || definitionId !== draft.definitionId || name !== baseline.name || value !== baseline.value || isSecret !== baseline.isSecret;
  useEffect(() => { onDirtyChange(dirty || pending); return () => onDirtyChange(false); }, [dirty, pending, onDirtyChange]);
  useEffect(() => { nameInput.current?.focus(); }, []);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy.current || pending || disabled) return;
    const invalidBinding = !ConfigNameSchema.safeParse(bindingName.trim()).success, invalidDisplay = !name.trim() || name.trim().length > 120;
    setNameError(invalidBinding ? t('config.form.invalidName') : undefined); setDisplayError(invalidDisplay ? t('config.form.invalidDisplayName') : undefined);
    if (invalidBinding || invalidDisplay) { if (invalidBinding) nameInput.current?.focus(); return; }
    busy.current = true; setNameError(undefined);
    try { await onSubmit({ id: draft.id, definitionId, expectedVersion: draft.expectedVersion, bindingName: bindingName.trim(), name: name.trim(), value, isSecret }); setValue(''); setBaseline({ name, value: '', isSecret }); }
    catch { /* 父组件显示服务端错误；输入保持原样。 */ }
    finally { busy.current = false; }
  };
  const locked = pending || disabled;
  return <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
    {!draft.id ? <label>{t('config.form.definition')}<select value={definitionId ?? ''} disabled={locked} onChange={(event) => { const selected = definitions.find((entry) => entry.id === event.target.value); setDefinitionId(selected?.id); if (selected) { setName(selected.name); setBindingName(selected.bindingName); } }}><option value="">{t('config.form.newDefinition')}</option>{definitions.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} ({entry.bindingName})</option>)}</select></label> : null}
    <FormField label={t('config.form.bindingName')} hint={t('config.form.nameHint')} hintId={`${id}-name-hint`} error={nameError} errorId={`${id}-name-error`}>
      <input ref={nameInput} value={bindingName} placeholder={t('config.form.namePlaceholder')} disabled={locked || !!definitionId} aria-invalid={!!nameError} aria-describedby={`${id}-name-hint${nameError ? ` ${id}-name-error` : ''}`} aria-errormessage={nameError ? `${id}-name-error` : undefined} onChange={(event) => { if (!name || name === bindingName) setName(event.target.value); setBindingName(event.target.value); setNameError(undefined); }} />
    </FormField>
    <FormField label={t('config.form.name')} hint={t('config.form.displayNameHint')} error={displayError} errorId={`${id}-display-error`}>
      <input value={name} disabled={locked} aria-invalid={!!displayError} aria-errormessage={displayError ? `${id}-display-error` : undefined} onChange={(event) => { setName(event.target.value); setDisplayError(undefined); }} />
    </FormField>
    <FormField label={t('config.form.value')} hint={t(isSecret ? 'config.form.secretValueHint' : 'config.form.valueHint')} hintId={`${id}-value-hint`}>
      <input type={isSecret ? 'password' : 'text'} value={value} disabled={locked} aria-describedby={`${id}-value-hint`} placeholder={t('config.form.valuePlaceholder')} onChange={(event) => setValue(event.target.value)} />
    </FormField>
    <FormField label={t('config.form.isSecret')} hint={t('config.form.isSecretHint')}>
      <input type="checkbox" checked={isSecret} disabled={locked} onChange={(event) => setIsSecret(event.target.checked)} />
    </FormField>
    {!draft.id && existingNames.includes(bindingName.trim()) ? <p>{t('config.form.overwriteHint', { name: name.trim() })}</p> : null}
    <div className={styles.buttons}>
      <Button variant="primary" type="submit" disabled={locked}>{pending ? t('config.form.submitting') : t('config.saveTo', { env: envLabel })}</Button>
      <Button variant="ghost" disabled={pending} onClick={onReset}>{t('config.cancel')}</Button>
    </div>
  </form>;
}
