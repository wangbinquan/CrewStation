import { useT } from '../../../../../shared/lib/useT';
import { Button } from '../../../../../shared/ui/Button';
import { ActionNote } from '../../../../../shared/ui/ActionNote';
import { AdminField } from '../../AdminField';
import type { ProviderDraftState } from '../../../hooks/useProviderDraft';
import styles from '../IdentityAdmin.module.css';

export function MappingFields({ draft }: { readonly draft: ProviderDraftState }) {
  const t = useT();
  const change = (index: number, field: 'key' | 'claim', value: string) => draft.set('claimMappings', draft.value.claimMappings.map((mapping, i) => i === index ? { ...mapping, [field]: value } : mapping));
  return <div className={styles.fieldStack}>
    <div className={styles.formGrid}>{(['usernameClaim', 'gitNameClaim', 'emailClaim', 'subjectClaim'] as const).map((field) => <AdminField key={field}
      label={t(`admin.auth.${field}`)} value={draft.value[field]} onChange={(value) => draft.set(field, value)}
      hint={`${t(`admin.auth.${field}Hint`)} ${t(`admin.auth.invalid.${field === 'usernameClaim' || field === 'gitNameClaim' ? 'claimList' : 'claim'}`)}`}
      error={draft.errors[field] ? t(draft.errors[field]) : undefined} />)}</div>
    <div className={styles.sectionHeading}><h3>{t('admin.auth.claimMappings')}</h3><Button disabled={draft.value.claimMappings.length >= 20} onClick={() => draft.set('claimMappings', [...draft.value.claimMappings, { key: '', claim: '' }])}>{t('admin.identity.addMapping')}</Button></div>
    <p className={styles.muted}>{t('admin.identity.mappingHint')}</p>
    {draft.errors.claimMappings ? <ActionNote tone="error">{t(draft.errors.claimMappings)}</ActionNote> : null}
    {draft.value.claimMappings.map((mapping, index) => <div key={index} className={styles.mappingRow}>
      <AdminField label={t('admin.identity.mappingKey', { number: index + 1 })} value={mapping.key} onChange={(value) => change(index, 'key', value)} error={draft.errors[`claimMappings.${index}.key`] ? t('admin.identity.mappingKeyError') : undefined} />
      <span aria-hidden="true" className={styles.mappingArrow}>←</span>
      <AdminField label={t('admin.identity.mappingClaim', { number: index + 1 })} value={mapping.claim} onChange={(value) => change(index, 'claim', value)} error={draft.errors[`claimMappings.${index}.claim`] ? t('admin.auth.invalid.claim') : undefined} />
      <Button variant="ghost" aria-label={t('admin.identity.removeMapping', { number: index + 1 })} onClick={() => draft.set('claimMappings', draft.value.claimMappings.filter((_, i) => i !== index))}>{t('admin.auth.remove')}</Button>
    </div>)}
  </div>;
}
