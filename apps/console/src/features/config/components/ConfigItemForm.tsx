import type { SetConfigItemInput } from '@crewstation/api-client';
import { ConfigNameSchema } from '@crewstation/contracts';
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { FormField } from '../../../shared/ui/FormField';
import styles from './ConfigItemForm.module.css';

export interface ConfigItemDraft {
  readonly name: string;
  readonly isSecret: boolean;
  /** 仅普通配置可预填；Secret 没有可读取的旧值。 */
  readonly value?: string;
}
export interface ConfigItemFormProps {
  readonly draft: ConfigItemDraft;
  readonly pending: boolean;
  readonly disabled?: boolean;
  readonly existingNames: readonly string[];
  readonly onSubmit: (input: SetConfigItemInput) => Promise<unknown>;
  readonly onReset: () => void;
  readonly onDirtyChange: (dirty: boolean) => void;
}

/** 请求成功后才清空值；失败、目录暂不可用和环境切换保留当前输入。 */
export function ConfigItemForm({ draft, pending, disabled = false, existingNames, onSubmit, onReset, onDirtyChange }: ConfigItemFormProps): ReactElement {
  const t = useT(), id = useId(), busy = useRef(false), nameInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(draft.name), [value, setValue] = useState(draft.isSecret ? '' : draft.value ?? '');
  const [isSecret, setIsSecret] = useState(draft.isSecret), [nameError, setNameError] = useState<string>();
  const [baseline, setBaseline] = useState({ name: draft.name, value: draft.isSecret ? '' : draft.value ?? '', isSecret: draft.isSecret });
  const dirty = name !== baseline.name || value !== baseline.value || isSecret !== baseline.isSecret;
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy.current || pending || disabled) return;
    if (!ConfigNameSchema.safeParse(name.trim()).success) { setNameError(t('config.form.invalidName')); nameInput.current?.focus(); return; }
    busy.current = true; setNameError(undefined);
    try { await onSubmit({ name: name.trim(), value, isSecret }); setValue(''); setBaseline({ name, value: '', isSecret }); }
    catch { /* 父组件显示服务端错误；输入保持原样。 */ }
    finally { busy.current = false; }
  };
  const locked = pending || disabled;
  return <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
    <FormField label={t('config.form.name')} hint={t('config.form.nameHint')} hintId={`${id}-name-hint`} error={nameError} errorId={`${id}-name-error`}>
      <input ref={nameInput} value={name} placeholder={t('config.form.namePlaceholder')} disabled={locked} aria-invalid={!!nameError} aria-describedby={`${id}-name-hint${nameError ? ` ${id}-name-error` : ''}`} aria-errormessage={nameError ? `${id}-name-error` : undefined} onChange={(event) => { setName(event.target.value); setNameError(undefined); }} />
    </FormField>
    <FormField label={t('config.form.value')} hint={t(isSecret ? 'config.form.secretValueHint' : 'config.form.valueHint')} hintId={`${id}-value-hint`}>
      <input type={isSecret ? 'password' : 'text'} value={value} disabled={locked} aria-describedby={`${id}-value-hint`} placeholder={t('config.form.valuePlaceholder')} onChange={(event) => setValue(event.target.value)} />
    </FormField>
    <FormField label={t('config.form.isSecret')} hint={t('config.form.isSecretHint')}>
      <input type="checkbox" checked={isSecret} disabled={locked} onChange={(event) => setIsSecret(event.target.checked)} />
    </FormField>
    {existingNames.includes(name.trim()) ? <p>{t('config.form.overwriteHint', { name: name.trim() })}</p> : null}
    <div className={styles.buttons}>
      <Button variant="primary" type="submit" disabled={locked}>{t(pending ? 'config.form.submitting' : 'config.form.submit')}</Button>
      <Button variant="ghost" disabled={locked} onClick={onReset}>{t('config.form.reset')}</Button>
    </div>
  </form>;
}
