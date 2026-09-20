import { useT } from '../../../../../shared/lib/useT';
import { Badge } from '../../../../../shared/ui/Badge';
import { ChoiceField } from '../../../../../shared/ui/selection/ChoiceField';
import { AdminField } from '../../AdminField';
import type { ProviderDraftState } from '../../../hooks/useProviderDraft';
import type { ProviderDraft } from '../../../model/providerDraft';
import { MappingFields } from './MappingFields';
import styles from '../IdentityAdmin.module.css';

type TextField = { [K in keyof ProviderDraft]: ProviderDraft[K] extends string ? K : never }[keyof ProviderDraft];
export function ProviderTextField({ draft, field, label = field, hint, disabled = false, password = false }: {
  readonly draft: ProviderDraftState; readonly field: TextField; readonly label?: string; readonly hint: string; readonly disabled?: boolean; readonly password?: boolean;
}) {
  const t = useT();
  return <AdminField label={t(`admin.auth.${label}`)} value={draft.value[field]} onChange={(value) => draft.set(field, value)} hint={t(`admin.auth.${hint}`)} error={draft.errors[field] ? t(draft.errors[field]) : undefined} disabled={disabled} type={password ? 'password' : 'text'} />;
}

export function ProviderFields({ draft, editing, secretSet }: { readonly draft: ProviderDraftState; readonly editing: boolean; readonly secretSet: boolean }) {
  const t = useT();
  if (draft.group === 'mapping') return <MappingFields draft={draft} />;
  if (draft.group === 'connection') return <div className={styles.formGrid}>
    {(['authorizationEndpoint', 'tokenEndpoint', 'userinfoEndpoint', 'jwksUri'] as const).map((field) => <ProviderTextField key={field} draft={draft} field={field} hint={field === 'authorizationEndpoint' ? 'manualHint' : 'invalid.url'} />)}
    <AdminField label={t('admin.auth.userinfoStyle')} hint={t('admin.auth.userinfoStyleHint')} value={draft.value.userinfoRequestStyle} onChange={(value) => draft.set('userinfoRequestStyle', value as ProviderDraft['userinfoRequestStyle'])} options={[{ value: 'get_bearer', label: t('admin.auth.styleGet') }, { value: 'post_json', label: t('admin.auth.stylePost') }]} />
  </div>;
  if (draft.group === 'account') return <div className={styles.formGrid}>
    <AdminField label={t('admin.auth.provisioning')} hint={t('admin.auth.provisioningHint')} value={draft.value.provisioning} onChange={(value) => draft.set('provisioning', value as ProviderDraft['provisioning'])} options={[{ value: 'allowlist', label: t('admin.auth.provisioningAllowlist') }, { value: 'auto', label: t('admin.auth.provisioningAuto') }]} />
    <ProviderTextField draft={draft} field="allowedDomains" label="allowedDomains" hint="allowedDomainsHint" />
    <ChoiceField label={t('admin.auth.trustEmail')} description={t('admin.auth.trustEmailHint')} checked={draft.value.trustEmailVerified} onChange={(e) => draft.set('trustEmailVerified', e.target.checked)} />
  </div>;
  return <div className={styles.formGrid}>
    <ProviderTextField draft={draft} field="displayName" hint="displayNameHint" />
    <ProviderTextField draft={draft} field="slug" hint="slugHint" disabled={editing} />
    <ProviderTextField draft={draft} field="issuerUrl" hint="issuerUrlHint" />
    <ProviderTextField draft={draft} field="clientId" hint="invalid.clientId" />
    <div className={styles.fieldStack}><ProviderTextField draft={draft} field="clientSecret" hint={editing ? 'clientSecretKeep' : 'clientSecretHint'} password />{editing ? <Badge tone={secretSet ? 'neutral' : 'warning'}>{t(secretSet ? 'admin.identity.secretSet' : 'admin.identity.secretMissing')}</Badge> : null}</div>
    <ProviderTextField draft={draft} field="scopes" hint="scopesHint" />
    <ChoiceField label={t('admin.auth.enabled')} description={t('admin.auth.enabledHint')} checked={draft.value.enabled} onChange={(e) => draft.set('enabled', e.target.checked)} />
  </div>;
}
