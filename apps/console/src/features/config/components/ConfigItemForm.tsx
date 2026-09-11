import type { SetConfigItemInput } from '@crewstation/api-client';
import { useState } from 'react';
import type { FormEvent, ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import styles from './ConfigItemForm.module.css';

export interface ConfigItemDraft {
  readonly name: string;
  readonly isSecret: boolean;
  /** 已存在的键：提交即覆盖并产生新版本，表单据此给出提示。 */
  readonly overwrite: boolean;
}

export interface ConfigItemFormProps {
  readonly draft: ConfigItemDraft;
  readonly pending: boolean;
  readonly onSubmit: (input: SetConfigItemInput) => void;
}

/**
 * 新增或覆盖一项。父组件换 draft 时用 key 重挂载本组件重置输入，
 * 避免在 effect 里 setState（React Compiler 规则禁止）。
 */
export function ConfigItemForm({ draft, pending, onSubmit }: ConfigItemFormProps): ReactElement {
  const t = useT();
  const [name, setName] = useState(draft.name);
  const [value, setValue] = useState('');
  const [isSecret, setIsSecret] = useState(draft.isSecret);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (name.length === 0) return;
    onSubmit({ name, value, isSecret });
    setValue('');
  };
  return (
    <form className={styles.form} onSubmit={submit}>
      <label className={styles.field}>
        <span className={styles.label}>{t('config.form.name')}</span>
        <input className={styles.input} value={name} placeholder={t('config.form.namePlaceholder')} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>{t('config.form.value')}</span>
        <input className={styles.input} value={value} placeholder={t('config.form.valuePlaceholder')} onChange={(e) => setValue(e.target.value)} />
      </label>
      <label className={styles.checkbox}>
        <input type="checkbox" checked={isSecret} onChange={(e) => setIsSecret(e.target.checked)} />
        <span>{t('config.form.isSecret')}</span>
      </label>
      <div className={styles.buttons}>
        <Button variant="primary" type="submit" disabled={pending}>
          {pending ? t('config.form.submitting') : t('config.form.submit')}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setName('');
            setValue('');
            setIsSecret(false);
          }}
        >
          {t('config.form.reset')}
        </Button>
      </div>
      <p className={styles.hint}>{draft.overwrite ? t('config.form.overwriteHint', { name: draft.name }) : t('config.form.nameHint')}</p>
      <p className={styles.hint}>{t('config.form.isSecretHint')}</p>
    </form>
  );
}
