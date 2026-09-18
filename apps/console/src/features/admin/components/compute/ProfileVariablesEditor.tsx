import type { ProfileCredentialState } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { Badge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import { FormField } from '../../../../shared/ui/FormField';
import type { ProfileDraft } from '../../model/profileDraft';
import type { CredentialOp, DraftErrors } from '../../model/stepDraft';
import { AdminField } from '../AdminField';
import styles from './ComputeEditor.module.css';

export interface ProfileVariablesEditorProps {
  readonly draft: ProfileDraft;
  readonly errors: DraftErrors;
  readonly credentials: readonly ProfileCredentialState[];
  readonly disabled: boolean;
  readonly onChange: (fn: (draft: ProfileDraft) => ProfileDraft) => void;
}

/** 普通变量明文可见；凭据只显示“已设置／未设置”，写入走 keep／replace／clear 三选一，保存后不回显。 */
export function ProfileVariablesEditor({ draft, errors, credentials, disabled, onChange }: ProfileVariablesEditorProps): ReactElement {
  const t = useT();
  const stored = new Map(credentials.map((credential) => [credential.name, credential]));
  const setVar = (index: number, patch: Partial<{ name: string; value: string }>) => onChange((d) => ({ ...d, vars: d.vars.map((v, i) => (i === index ? { ...v, ...patch } : v)) }));
  const renameSecret = (index: number, name: string) => onChange((d) => {
    const previous = d.secretNames[index]!;
    const { [previous]: op, ...rest } = d.credentials;
    return { ...d, secretNames: d.secretNames.map((n, i) => (i === index ? name : n)), credentials: { ...rest, [name]: op ?? { op: 'replace', value: '' } } };
  });
  const setOp = (name: string, op: CredentialOp) => onChange((d) => ({ ...d, credentials: { ...d.credentials, [name]: op } }));
  const undeclare = (name: string) => onChange((d) => {
    const { [name]: _dropped, ...rest } = d.credentials;
    // 取消声明时把已存的值一并清掉，避免留下无人引用却仍可解密的密文。
    return { ...d, secretNames: d.secretNames.filter((n) => n !== name), credentials: stored.get(name)?.set ? { ...rest, [name]: { op: 'clear' } } : rest };
  });
  return (
    <>
      <div className={styles.sub}>
        <h3>{t('admin.profile.vars.title')}</h3>
        <p className={styles.hint}>{t('admin.profile.vars.hint')}</p>
        {draft.vars.map((variable, index) => (
          <div key={index} className={styles.credential}>
            <AdminField label={t('admin.profile.vars.name')} value={variable.name} onChange={(name) => setVar(index, { name })} disabled={disabled} error={errors[`vars.${index}.name`] ? t(`admin.profile.error.${errors[`vars.${index}.name`]}`) : undefined} />
            <span />
            <AdminField label={t('admin.profile.vars.value')} value={variable.value} onChange={(value) => setVar(index, { value })} disabled={disabled} />
            <Button variant="ghost" disabled={disabled} onClick={() => onChange((d) => ({ ...d, vars: d.vars.filter((_, i) => i !== index) }))}>{t('admin.profile.vars.remove')}</Button>
          </div>
        ))}
        <div className={styles.toolbar}><Button disabled={disabled} onClick={() => onChange((d) => ({ ...d, vars: [...d.vars, { name: '', value: '' }] }))}>{t('admin.profile.vars.add')}</Button></div>
      </div>
      <div className={styles.sub}>
        <h3>{t('admin.profile.secrets.title')}</h3>
        <p className={styles.hint}>{t('admin.profile.secrets.hint')}</p>
        {draft.secretNames.map((name, index) => {
          const existing = stored.get(name);
          const op = draft.credentials[name] ?? { op: existing ? 'keep' : 'replace', value: '' } as CredentialOp;
          return (
            <div key={existing ? name : `new-${index}`} className={styles.credential}>
              {existing ? <code>{name}</code> : <AdminField label={t('admin.profile.vars.name')} value={name} onChange={(next) => renameSecret(index, next)} disabled={disabled} error={errors[`secrets.${index}`] ? t(`admin.profile.error.${errors[`secrets.${index}`]}`) : undefined} />}
              <Badge tone={existing?.set ? 'success' : 'warning'}>{t(existing?.set ? 'admin.profile.secrets.set' : 'admin.profile.secrets.unset')}</Badge>
              <div className={styles.toolbar}>
                {existing ? (
                  <select aria-label={`${name} ${t('admin.profile.secrets.title')}`} value={op.op} disabled={disabled} onChange={(event) => setOp(name, event.target.value === 'replace' ? { op: 'replace', value: '' } : event.target.value === 'clear' ? { op: 'clear' } : { op: 'keep' })}>
                    <option value="keep">{t('admin.profile.secrets.keep')}</option>
                    <option value="replace">{t('admin.profile.secrets.replace')}</option>
                    <option value="clear">{t('admin.profile.secrets.clear')}</option>
                  </select>
                ) : null}
                {op.op === 'replace' ? (
                  <FormField label={t('admin.profile.secrets.replace')}>
                    <input type="password" autoComplete="new-password" value={op.value} placeholder={t('admin.profile.secrets.valuePlaceholder')} disabled={disabled} onChange={(event) => setOp(name, { op: 'replace', value: event.target.value })} />
                  </FormField>
                ) : null}
              </div>
              <Button variant="ghost" disabled={disabled} onClick={() => undeclare(name)}>{t('admin.profile.secrets.remove')}</Button>
            </div>
          );
        })}
        <div className={styles.toolbar}><Button disabled={disabled} onClick={() => onChange((d) => ({ ...d, secretNames: [...d.secretNames, ''], credentials: { ...d.credentials, '': { op: 'replace', value: '' } } }))}>{t('admin.profile.secrets.add')}</Button></div>
      </div>
    </>
  );
}
