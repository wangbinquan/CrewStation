import { newDraftResourceId } from '@crewstation/api-client';
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
  const stored = new Map(credentials.map((credential) => [credential.id, credential]));
  const setVar = (index: number, patch: Partial<{ name: string; value: string }>) => onChange((d) => ({ ...d, vars: d.vars.map((v, i) => (i === index ? { ...v, ...patch } : v)) }));
  const renameSecret = (id: string, name: string) => onChange((draft) => ({ ...draft, secrets: draft.secrets.map((secret) => secret.id === id ? { ...secret, name } : secret) }));
  const setOp = (id: string, op: CredentialOp) => onChange((draft) => ({ ...draft, credentials: { ...draft.credentials, [id]: op } }));
  const undeclare = (id: string) => onChange((draft) => {
    const { [id]: _dropped, ...rest } = draft.credentials;
    return { ...draft, secrets: draft.secrets.filter((secret) => secret.id !== id), credentials: stored.get(id)?.set ? { ...rest, [id]: { op: 'clear' } } : rest };
  });
  const addSecret = () => onChange((draft) => {
    const id = newDraftResourceId();
    return { ...draft, secrets: [...draft.secrets, { id, name: '' }], credentials: { ...draft.credentials, [id]: { op: 'replace', value: '' } } };
  });
  return (
    <>
      <div className={styles.sub}>
        <h3>{t('admin.profile.vars.title')}</h3>
        <p className={styles.hint}>{t('admin.profile.vars.hint')}</p>
        {draft.vars.map((variable, index) => (
          <div key={index} className={styles.variable}>
            <AdminField label={t('admin.profile.vars.name')} value={variable.name} onChange={(name) => setVar(index, { name })} disabled={disabled} error={errors[`vars.${index}.name`] ? t(`admin.profile.error.${errors[`vars.${index}.name`]}`) : undefined} />
            <AdminField label={t('admin.profile.vars.value')} value={variable.value} onChange={(value) => setVar(index, { value })} disabled={disabled} />
            <Button variant="ghost" className={styles.dangerAction} disabled={disabled} onClick={() => onChange((d) => ({ ...d, vars: d.vars.filter((_, i) => i !== index) }))}>{t('admin.profile.vars.remove')}</Button>
          </div>
        ))}
        <div className={styles.toolbar}><Button disabled={disabled} onClick={() => onChange((d) => ({ ...d, vars: [...d.vars, { name: '', value: '' }] }))}>{t('admin.profile.vars.add')}</Button></div>
      </div>
      <div className={styles.sub}>
        <h3>{t('admin.profile.secrets.title')}</h3>
        <p className={styles.hint}>{t('admin.profile.secrets.hint')}</p>
        {draft.secrets.map(({ id, name }, index) => {
          const existing = stored.get(id);
          const op = draft.credentials[id] ?? { op: existing ? 'keep' : 'replace', value: '' } as CredentialOp;
          return (
            <div key={id} className={styles.credential}>
              <div className={styles.credentialFields}>
              <AdminField label={t('admin.profile.vars.name')} value={name} onChange={(next) => renameSecret(id, next)} disabled={disabled} error={errors[`secrets.${index}`] ? t(`admin.profile.error.${errors[`secrets.${index}`]}`) : undefined} />
              <div className={styles.toolbar}><Badge tone={existing?.set ? 'success' : 'warning'}>{t(existing?.set ? 'admin.profile.secrets.set' : 'admin.profile.secrets.unset')}</Badge></div>
              </div>
              <div className={styles.credentialFields}>
                {existing ? (
                  <AdminField label={`${name} ${t('admin.profile.secrets.title')}`} value={op.op} disabled={disabled}
                    onChange={(value) => setOp(id, value === 'replace' ? { op: 'replace', value: '' } : value === 'clear' ? { op: 'clear' } : { op: 'keep' })}
                    options={(['keep', 'replace', 'clear'] as const).map((value) => ({ value, label: t(`admin.profile.secrets.${value}`) }))} />
                ) : null}
                {op.op === 'replace' ? (
                  <FormField label={t('admin.profile.secrets.replace')}>
                    <input type="password" autoComplete="new-password" value={op.value} placeholder={t('admin.profile.secrets.valuePlaceholder')} disabled={disabled} onChange={(event) => setOp(id, { op: 'replace', value: event.target.value })} />
                  </FormField>
                ) : null}
              </div>
              <Button variant="ghost" className={styles.dangerAction} disabled={disabled} onClick={() => undeclare(id)}>{t('admin.profile.secrets.remove')}</Button>
            </div>
          );
        })}
        <div className={styles.toolbar}><Button disabled={disabled} onClick={addSecret}>{t('admin.profile.secrets.add')}</Button></div>
      </div>
    </>
  );
}
