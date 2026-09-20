import type { CreateOidcProviderRequest, OidcProviderDto } from '@crewstation/contracts';
import { useRef, useState } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { ActionRow } from '../../../../shared/ui/ActionRow';
import { Badge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { InlineConfirm } from '../../../../shared/ui/InlineConfirm';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { MutationError } from '../MutationError';
import { useProviderProbe, providerVersion } from '../../hooks/useProviderProbe';
import { ProviderForm } from './ProviderForm';
import { ProviderProbePanel } from './provider/ProviderProbePanel';
import styles from './IdentityAdmin.module.css';

export function ProvidersCard() {
  const t = useT(), [editing, setEditing] = useState<OidcProviderDto | 'new'>();
  const providers = useApiQuery(queryKeys.authProviders(), () => api.auth.listProviders());
  const probe = useProviderProbe(), openerId = useRef('');
  const close = () => { setEditing(undefined); requestAnimationFrame(() => document.getElementById(openerId.current)?.focus()); };
  const invalidate = [queryKeys.authProviders(), queryKeys.loginPolicy(), queryKeys.identityForwarding()];
  const create = useApiMutation((body: CreateOidcProviderRequest) => api.auth.createProvider(body), { invalidate, onSuccess: close });
  const patch = useApiMutation((input: { id: string; body: CreateOidcProviderRequest }) => api.auth.patchProvider(input.id, input.body), { invalidate, onSuccess: (provider) => { probe.invalidate(provider.id); close(); } });
  const remove = useApiMutation((id: string) => api.auth.removeProvider(id), { invalidate, onSuccess: close });
  const begin = (provider: OidcProviderDto | 'new') => { create.reset(); patch.reset(); remove.reset(); openerId.current = provider === 'new' ? 'provider-new' : `provider-${provider.id}`; setEditing(provider); };
  if (editing) return <Card className={styles.container} stacked title={editing === 'new' ? t('admin.auth.providerNew') : editing.displayName} extra={<Badge>{editing === 'new' ? t('admin.identity.newProvider') : editing.slug}</Badge>}>
    <ProviderForm key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? undefined : editing} busy={create.isPending || patch.isPending || remove.isPending}
      error={create.error?.message ?? patch.error?.message} onCancel={close} onSubmit={(body) => editing === 'new' ? create.mutate(body) : patch.mutate({ id: editing.id, body })} />
    {editing !== 'new' ? <div className={styles.danger}><strong>{t('admin.identity.removeProvider')}</strong><p className={styles.muted}>{t('admin.auth.removeQuestion')}</p>
      <InlineConfirm label={t('admin.identity.removeProvider')} question={t('admin.auth.removeQuestion')} busy={remove.isPending || patch.isPending} onConfirm={() => remove.mutate(editing.id)} />
      <MutationError error={remove.error} messageKey="admin.auth.providerSaveError" />
    </div> : null}
  </Card>;
  const items = providers.data?.items ?? [];
  return <Card className={styles.container} stacked title={t('admin.auth.providersTitle')} extra={<Button id="provider-new" variant="primary" onClick={() => begin('new')}>{t('admin.auth.providerNew')}</Button>} footer={t('admin.auth.providersHint')}>
    <QueryStatus isPending={providers.isPending} error={providers.error} isEmpty={!items.length} emptyTitle={t('admin.auth.providersEmptyTitle')} emptyDescription={t('admin.auth.providersEmptyDescription')} />
    {providers.error ? <Button onClick={() => void providers.refetch()}>{t('admin.identity.retry')}</Button> : null}
    <div>{items.map((provider) => {
      const current = probe.probes[provider.id], stale = current !== undefined && current.version !== providerVersion(provider);
      return <div className={styles.providerRow} key={provider.id}>
        <div className={styles.providerIdentity}><span className={styles.mark} aria-hidden="true">{Array.from(provider.displayName)[0]}</span>
          <div className={styles.providerDetails}><div className={styles.providerTitle}><strong>{provider.displayName}</strong><Badge tone={provider.enabled ? 'success' : 'neutral'}>{t(provider.enabled ? 'admin.auth.on' : 'admin.auth.off')}</Badge></div>
            <div className={styles.meta}><code>{provider.slug}</code><span title={provider.issuerUrl}>{new URL(provider.issuerUrl).host}</span></div>
            <span className={styles.muted}>{t(provider.provisioning === 'allowlist' ? 'admin.auth.provisioningAllowlist' : 'admin.auth.provisioningAuto')}</span>
          </div>
        </div>
        <ActionRow><Button id={`provider-${provider.id}`} onClick={() => begin(provider)}>{t('admin.auth.edit')}</Button>
          <Button variant="ghost" disabled={current?.pending && !stale} onClick={() => void probe.run(provider)}>{t(current?.pending && !stale ? 'admin.auth.testing' : 'admin.auth.test')}</Button>
        </ActionRow>
        {current ? <ProviderProbePanel probe={current} stale={stale} /> : <span className={styles.muted}>{t('admin.identity.notTested')}</span>}
      </div>;
    })}</div>
  </Card>;
}
