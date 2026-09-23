import type { CreateOidcProviderRequest, OidcProviderDto } from '@crewstation/contracts';
import { useState } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { errorMessage, useApiMutation, useApiQuery } from '../../../../shared/api/useApi';
import { useDraftTarget } from '../../../../shared/lib/useDraftTarget';
import { useT } from '../../../../shared/lib/useT';
import { ActionRow } from '../../../../shared/ui/ActionRow';
import { Badge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { ConfirmDialog } from '../../../../shared/ui/dialog/ConfirmDialog';
import { ConfirmationDialog } from '../../../../shared/ui/dialog/ConfirmationDialog';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { useProviderProbe, providerVersion } from '../../hooks/useProviderProbe';
import { ProviderForm } from './ProviderForm';
import { ProviderProbePanel } from './provider/ProviderProbePanel';
import styles from './IdentityAdmin.module.css';

/**
 * 身份提供方：列表常驻；新增与编辑是大弹窗（2026-09-23 起），草稿关窗不丢、再点同一个入口恢复；
 * 有未保存输入时改编辑别的接入方先确认。删除在编辑弹窗底部，不可撤销，弹窗里输入 delete 才能确认。
 */
export function ProvidersCard() {
  const t = useT(), panel = useDraftTarget<OidcProviderDto | 'new'>((current, next) => (current === 'new' || next === 'new' ? current === next : current.id === next.id));
  const [removing, setRemoving] = useState(false);
  const providers = useApiQuery(queryKeys.authProviders(), () => api.auth.listProviders());
  const probe = useProviderProbe();
  const invalidate = [queryKeys.authProviders(), queryKeys.loginPolicy(), queryKeys.identityForwarding()];
  const create = useApiMutation((body: CreateOidcProviderRequest) => api.auth.createProvider(body), { invalidate, onSuccess: panel.close });
  const patch = useApiMutation((input: { id: string; body: CreateOidcProviderRequest }) => api.auth.patchProvider(input.id, input.body), { invalidate, onSuccess: (provider) => { probe.invalidate(provider.id); panel.close(); } });
  const remove = useApiMutation((id: string) => api.auth.removeProvider(id), { invalidate, onSuccess: panel.close });
  const begin = (provider: OidcProviderDto | 'new') => { create.reset(); patch.reset(); remove.reset(); setRemoving(false); panel.select(provider); };
  const editing = panel.target, busy = create.isPending || patch.isPending || remove.isPending;
  const nameOf = (value: OidcProviderDto | 'new' | undefined) => (value && value !== 'new' ? value.displayName : t('admin.auth.providerNew'));
  const dialogs = <>
    {panel.switching ? <ConfirmationDialog question={t('ui.draft.question', { scope: nameOf(editing) })} hint={t('ui.draft.hint')} confirmLabel={t('ui.draft.leave')} cancelLabel={t('ui.draft.stay')} focus="cancel" onConfirm={panel.confirm} onCancel={panel.keep} /> : null}
    {panel.hasDraft && editing ? <ProviderForm key={panel.sequence} open={panel.open} initial={editing === 'new' ? undefined : editing} busy={busy}
      error={create.error?.message ?? patch.error?.message ?? (remove.error ? t('admin.auth.providerSaveError', { message: errorMessage(remove.error) }) : undefined)}
      actions={editing !== 'new' ? <Button variant="danger" disabled={busy} onClick={() => { remove.reset(); setRemoving(true); }}>{t('admin.identity.removeProvider')}</Button> : undefined}
      onDirtyChange={panel.dirtyChanged} onClose={panel.hide} onClear={panel.clear} onSubmit={(body) => (editing === 'new' ? create.mutate(body) : patch.mutate({ id: editing.id, body }))} /> : null}
    {/* 删除不可撤销：弹窗输入 delete 才能确认（2026-09-23 作者裁定）；请求结束后关闭，失败原因显示在编辑弹窗里。 */}
    {removing && editing && editing !== 'new' ? <ConfirmDialog title={t('admin.identity.removeProvider')} question={t('admin.identity.removeProviderQuestion', { name: editing.displayName, slug: editing.slug })} confirmWord="delete"
      confirmLabel={t('admin.identity.removeProviderConfirm')} busy={remove.isPending} busyLabel={t('admin.identity.removingProvider')} confirmDisabled={patch.isPending}
      onConfirm={() => remove.mutate(editing.id, { onSettled: () => setRemoving(false) })} onCancel={() => setRemoving(false)}>
      <p>{t('admin.auth.removeQuestion')}</p>
    </ConfirmDialog> : null}
  </>;
  const items = providers.data?.items ?? [];
  return <Card className={styles.container} stacked title={t('admin.auth.providersTitle')} extra={<Button id="provider-new" variant="primary" onClick={() => begin('new')}>{t('admin.auth.providerNew')}</Button>} footer={t('admin.auth.providersHint')}>
    {dialogs}
    <QueryStatus isPending={providers.isPending} error={providers.error} isEmpty={!items.length} emptyTitle={t('admin.auth.providersEmptyTitle')} emptyDescription={t('admin.auth.providersEmptyDescription')} />
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
