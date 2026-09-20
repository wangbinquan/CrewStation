import type { CreateOidcProviderRequest, OidcProviderDto, ProvisioningPolicy, UserinfoRequestStyle } from '@crewstation/contracts';
import { useEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { AdminField } from '../AdminField';
import { AdminForm } from '../AdminForm';
import { Button } from '../../../../shared/ui/Button';
import { UnsavedChangesGuard } from '../../../../shared/navigation/UnsavedChangesGuard';
import { providerErrors } from '../../model/providerValidation';

export interface ProviderFormProps {
  /** 给出即为编辑：留空的密钥表示保持原值。 */
  readonly initial?: OidcProviderDto;
  readonly busy: boolean;
  readonly onCancel?: () => void;
  readonly error?: ReactNode;
  readonly onSubmit: (body: CreateOidcProviderRequest) => void;
}

const blankToNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());
const list = (value: string): string[] => value.split(',').map((item) => item.trim()).filter((item) => item !== '');

type Draft = ReturnType<typeof useProviderDraft>;

/** 表单状态与「怎么变成请求体」放在一处：空串一律按 null 上线，等号对解析成自定义映射。 */
function useProviderDraft(initial: OidcProviderDto | undefined) {
  const [value, setValue] = useState({
    slug: initial?.slug ?? '',
    displayName: initial?.displayName ?? '',
    issuerUrl: initial?.issuerUrl ?? '',
    clientId: initial?.clientId ?? '',
    clientSecret: '',
    scopes: initial?.scopes ?? 'openid profile email',
    provisioning: (initial?.provisioning ?? 'allowlist') as ProvisioningPolicy,
    allowedDomains: (initial?.allowedEmailDomains ?? []).join(', '),
    authorizationEndpoint: initial?.authorizationEndpoint ?? '',
    tokenEndpoint: initial?.tokenEndpoint ?? '',
    userinfoEndpoint: initial?.userinfoEndpoint ?? '',
    jwksUri: initial?.jwksUri ?? '',
    userinfoRequestStyle: (initial?.userinfoRequestStyle ?? 'get_bearer') as UserinfoRequestStyle,
    trustEmailVerified: initial?.trustEmailVerified === true ? 'yes' : 'no',
    usernameClaim: initial?.usernameClaim ?? '',
    gitNameClaim: initial?.gitNameClaim ?? '',
    emailClaim: initial?.emailClaim ?? '',
    subjectClaim: initial?.subjectClaim ?? '',
    claimMappings: (initial?.claimMappings ?? []).map((mapping) => `${mapping.key}=${mapping.claim}`).join(', '),
    enabled: initial?.enabled === false ? 'no' : 'yes',
  });
  const [baseline] = useState(() => JSON.stringify(value));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [validationAttempt, setValidationAttempt] = useState(0);
  const set = (key: keyof typeof value) => (next: string) => { setValue((current) => ({ ...current, [key]: next })); setErrors((current) => ({ ...current, [key]: '' })); };
  const toRequest = (): CreateOidcProviderRequest => ({
    slug: value.slug,
    displayName: value.displayName,
    issuerUrl: value.issuerUrl,
    clientId: value.clientId,
    // 编辑时留空＝保持原值，所以只在填了的时候带上它。
    ...(value.clientSecret === '' ? {} : { clientSecret: value.clientSecret }),
    scopes: value.scopes,
    provisioning: value.provisioning,
    allowedEmailDomains: list(value.allowedDomains),
    iconUrl: null,
    enabled: value.enabled === 'yes',
    authorizationEndpoint: blankToNull(value.authorizationEndpoint),
    tokenEndpoint: blankToNull(value.tokenEndpoint),
    userinfoEndpoint: blankToNull(value.userinfoEndpoint),
    jwksUri: blankToNull(value.jwksUri),
    userinfoRequestStyle: value.userinfoRequestStyle,
    trustEmailVerified: value.trustEmailVerified === 'yes',
    usernameClaim: blankToNull(value.usernameClaim),
    gitNameClaim: blankToNull(value.gitNameClaim),
    emailClaim: blankToNull(value.emailClaim),
    subjectClaim: blankToNull(value.subjectClaim),
    claimMappings: list(value.claimMappings).map((pair) => {
      const [key = '', ...claimParts] = pair.split('=');
      const claim = claimParts.join('=');
      return { key: key.trim(), claim: claim.trim() };
    }),
  } as CreateOidcProviderRequest);
  const validate = () => {
    const body = toRequest(), next = providerErrors(body, initial !== undefined);
    setErrors(next);
    setValidationAttempt((attempt) => attempt + 1);
    return Object.keys(next).length ? undefined : body;
  };
  return { value, set, errors, validate, validationAttempt, dirty: baseline !== JSON.stringify(value) };
}

function IdentityFields({ draft, editing }: { readonly draft: Draft; readonly editing: boolean }): ReactElement {
  const t = useT();
  return (
    <>
      <AdminField label={t('admin.auth.slug')} value={draft.value.slug} error={draft.errors.slug ? t(draft.errors.slug) : undefined} onChange={draft.set('slug')} hint={t('admin.auth.slugHint')} placeholder="corp-sso" disabled={editing} />
      <AdminField label={t('admin.auth.displayName')} value={draft.value.displayName} error={draft.errors.displayName ? t(draft.errors.displayName) : undefined} onChange={draft.set('displayName')} hint={t('admin.auth.displayNameHint')} />
      <AdminField label={t('admin.auth.issuerUrl')} value={draft.value.issuerUrl} error={draft.errors.issuerUrl ? t(draft.errors.issuerUrl) : undefined} onChange={draft.set('issuerUrl')} hint={t('admin.auth.issuerUrlHint')} placeholder="https://idp.corp.com" />
      <AdminField label={t('admin.auth.clientId')} value={draft.value.clientId} error={draft.errors.clientId ? t(draft.errors.clientId) : undefined} onChange={draft.set('clientId')} hint={t('admin.auth.invalid.clientId')} />
      <AdminField label={t('admin.auth.clientSecret')} type="password" value={draft.value.clientSecret} error={draft.errors.clientSecret ? t(draft.errors.clientSecret) : undefined} onChange={draft.set('clientSecret')} hint={editing ? t('admin.auth.clientSecretKeep') : t('admin.auth.clientSecretHint')} />
      <AdminField label={t('admin.auth.scopes')} value={draft.value.scopes} error={draft.errors.scopes ? t(draft.errors.scopes) : undefined} onChange={draft.set('scopes')} hint={t('admin.auth.scopesHint')} />
    </>
  );
}

function EndpointFields({ draft }: { readonly draft: Draft }): ReactElement {
  const t = useT();
  return (
    <>
      <AdminField label={t('admin.auth.authorizationEndpoint')} value={draft.value.authorizationEndpoint} error={draft.errors.authorizationEndpoint ? t(draft.errors.authorizationEndpoint) : undefined} onChange={draft.set('authorizationEndpoint')} hint={t('admin.auth.manualHint')} placeholder="https://idp.corp.com/oauth/authorize" />
      <AdminField label={t('admin.auth.tokenEndpoint')} value={draft.value.tokenEndpoint} error={draft.errors.tokenEndpoint ? t(draft.errors.tokenEndpoint) : undefined} onChange={draft.set('tokenEndpoint')} hint={t('admin.auth.invalid.url')} placeholder="https://idp.corp.com/oauth/token" />
      <AdminField label={t('admin.auth.userinfoEndpoint')} value={draft.value.userinfoEndpoint} error={draft.errors.userinfoEndpoint ? t(draft.errors.userinfoEndpoint) : undefined} onChange={draft.set('userinfoEndpoint')} hint={t('admin.auth.invalid.url')} placeholder="https://idp.corp.com/api/user" />
      <AdminField label={t('admin.auth.jwksUri')} value={draft.value.jwksUri} error={draft.errors.jwksUri ? t(draft.errors.jwksUri) : undefined} onChange={draft.set('jwksUri')} hint={t('admin.auth.invalid.url')} placeholder="https://idp.corp.com/jwks.json" />
      <AdminField
        label={t('admin.auth.userinfoStyle')}
        value={draft.value.userinfoRequestStyle} error={draft.errors.userinfoRequestStyle ? t(draft.errors.userinfoRequestStyle) : undefined}
        onChange={draft.set('userinfoRequestStyle')}
        hint={t('admin.auth.userinfoStyleHint')}
        options={[{ value: 'get_bearer', label: t('admin.auth.styleGet') }, { value: 'post_json', label: t('admin.auth.stylePost') }]}
      />
    </>
  );
}

function BehaviorFields({ draft }: { readonly draft: Draft }): ReactElement {
  const t = useT();
  return (
    <>
      <AdminField
        label={t('admin.auth.provisioning')}
        value={draft.value.provisioning} error={draft.errors.provisioning ? t(draft.errors.provisioning) : undefined}
        onChange={draft.set('provisioning')}
        hint={t('admin.auth.provisioningHint')}
        options={[{ value: 'allowlist', label: t('admin.auth.provisioningAllowlist') }, { value: 'auto', label: t('admin.auth.provisioningAuto') }]}
      />
      <AdminField label={t('admin.auth.allowedDomains')} value={draft.value.allowedDomains} error={draft.errors.allowedDomains ? t(draft.errors.allowedDomains) : undefined} onChange={draft.set('allowedDomains')} disabled={draft.value.provisioning !== 'allowlist'} hint={t('admin.auth.allowedDomainsHint')} placeholder="@corp.com, @sub.corp.com" />
      <AdminField
        label={t('admin.auth.trustEmail')}
        value={draft.value.trustEmailVerified} error={draft.errors.trustEmailVerified ? t(draft.errors.trustEmailVerified) : undefined}
        onChange={draft.set('trustEmailVerified')}
        hint={t('admin.auth.trustEmailHint')}
        options={[{ value: 'no', label: t('admin.auth.no') }, { value: 'yes', label: t('admin.auth.yes') }]}
      />
      <AdminField label={t('admin.auth.usernameClaim')} value={draft.value.usernameClaim} error={draft.errors.usernameClaim ? t(draft.errors.usernameClaim) : undefined} onChange={draft.set('usernameClaim')} hint={`${t('admin.auth.usernameClaimHint')} ${t('admin.auth.invalid.claimList')}`} placeholder="preferred_username" />
      <AdminField label={t('admin.auth.gitNameClaim')} value={draft.value.gitNameClaim} error={draft.errors.gitNameClaim ? t(draft.errors.gitNameClaim) : undefined} onChange={draft.set('gitNameClaim')} hint={`${t('admin.auth.gitNameClaimHint')} ${t('admin.auth.invalid.claimList')}`} placeholder="git_name" />
      <AdminField label={t('admin.auth.emailClaim')} value={draft.value.emailClaim} error={draft.errors.emailClaim ? t(draft.errors.emailClaim) : undefined} onChange={draft.set('emailClaim')} hint={`${t('admin.auth.emailClaimHint')} ${t('admin.auth.invalid.claim')}`} placeholder="email" />
      <AdminField label={t('admin.auth.subjectClaim')} value={draft.value.subjectClaim} error={draft.errors.subjectClaim ? t(draft.errors.subjectClaim) : undefined} onChange={draft.set('subjectClaim')} hint={`${t('admin.auth.subjectClaimHint')} ${t('admin.auth.invalid.claim')}`} placeholder="sub" />
      <AdminField label={t('admin.auth.claimMappings')} value={draft.value.claimMappings} error={draft.errors.claimMappings ? t(draft.errors.claimMappings) : undefined} onChange={draft.set('claimMappings')} hint={t('admin.auth.claimMappingsHint')} placeholder="employee-no=empNo, department=deptName" />
      <AdminField
        label={t('admin.auth.enabled')}
        value={draft.value.enabled} error={draft.errors.enabled ? t(draft.errors.enabled) : undefined}
        onChange={draft.set('enabled')}
        hint={t('admin.auth.enabledHint')}
        options={[{ value: 'yes', label: t('admin.auth.on') }, { value: 'no', label: t('admin.auth.off') }]}
      />
    </>
  );
}

/**
 * 身份提供方表单：配置项与 agent-workflow 的 OidcProviderDialog 逐项一致（RFC-005 §6.3），
 * 只少了它的 invite 开通档（作者裁定 A3），多了一块自定义字段映射（A10）。
 * 控件全部走本仓 shared 的 FormField／AdminForm，不自写 chrome。
 */
export function ProviderForm({ initial, busy, error, onSubmit, onCancel }: ProviderFormProps): ReactElement {
  const t = useT();
  const draft = useProviderDraft(initial);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { root.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(); }, [draft.validationAttempt]);
  return (<div ref={root}>
    <UnsavedChangesGuard dirty={draft.dirty || busy} scope={t('admin.auth.providersTitle')} />
    <AdminForm
      submitLabel={initial === undefined ? t('admin.auth.providerAdd') : t('admin.auth.providerSave')}
      busyLabel={t('admin.auth.saving')}
      busy={busy}
      incomplete={false}
      extraActions={onCancel ? <Button disabled={busy} onClick={onCancel}>{t('admin.auth.cancelEdit')}</Button> : undefined}
      error={error}
      note={t('admin.auth.providerNote')}
      onSubmit={() => { if (busy) return; const body = draft.validate(); if (body) onSubmit(body); }}
    >
      <IdentityFields draft={draft} editing={initial !== undefined} />
      <EndpointFields draft={draft} />
      <BehaviorFields draft={draft} />
    </AdminForm>
  </div>);
}
