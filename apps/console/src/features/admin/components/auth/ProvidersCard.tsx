import type { CreateOidcProviderRequest, OidcProbeResult, OidcProviderDto } from '@crewstation/contracts';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Badge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { DataTable } from '../../../../shared/ui/DataTable';
import { InlineConfirm } from '../../../../shared/ui/InlineConfirm';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { MutationError } from '../MutationError';
import { ProviderForm } from './ProviderForm';

function probeSummary(result: OidcProbeResult, t: (key: string) => string): string {
  const endpoints = Object.entries(result.endpoints)
    .map(([key, value]) => `${key}: ${value === null ? t('admin.auth.probeMissing') : `${value.source} ${value.url}`}`)
    .join('；');
  const discovery = result.discovery.ok ? t('admin.auth.probeDiscoveryOk') : `${t('admin.auth.probeDiscoveryFailed')}${result.discovery.error ? `（${result.discovery.error}）` : ''}`;
  const jwks = result.jwksReachable === undefined ? '' : `｜JWKS ${result.jwksReachable ? t('admin.auth.probeReachable') : t('admin.auth.probeUnreachable')}`;
  return `${result.ok ? t('admin.auth.probeOk') : t('admin.auth.probeNotOk')}｜${discovery}${jwks}｜${endpoints}`;
}

/** 身份提供方列表与编辑：新增、改、停用、删除、测试连接（RFC-005 §6.2）。 */
export function ProvidersCard(): ReactElement {
  const t = useT();
  const [editing, setEditing] = useState<OidcProviderDto | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const [probe, setProbe] = useState<{ slug: string; text: string } | undefined>(undefined);
  const providers = useApiQuery(queryKeys.authProviders(), () => api.auth.listProviders());
  const invalidate = [queryKeys.authProviders(), queryKeys.loginPolicy(), queryKeys.identityForwarding()];
  const create = useApiMutation((body: CreateOidcProviderRequest) => api.auth.createProvider(body), { invalidate, onSuccess: () => setAdding(false) });
  const patch = useApiMutation((input: { id: string; body: CreateOidcProviderRequest }) => api.auth.patchProvider(input.id, input.body), { invalidate, onSuccess: () => setEditing(undefined) });
  const remove = useApiMutation((id: string) => api.auth.removeProvider(id), { invalidate });
  const test = useApiMutation((provider: OidcProviderDto) => api.auth.testProvider(provider.id), {
    onSuccess: () => undefined,
  });
  const items = providers.data?.items ?? [];

  return (
    <Card title={t('admin.auth.providersTitle')} footer={t('admin.auth.providersHint')}>
      <MutationError error={create.error ?? patch.error ?? remove.error ?? test.error} messageKey="admin.auth.providerSaveError" />
      <QueryStatus
        isPending={providers.isPending}
        error={providers.error}
        isEmpty={items.length === 0}
        emptyTitle={t('admin.auth.providersEmptyTitle')}
        emptyDescription={t('admin.auth.providersEmptyDescription')}
      />
      {items.length > 0 ? (
        <DataTable columns={[t('admin.auth.slug'), t('admin.auth.displayName'), t('admin.auth.issuerUrl'), t('admin.auth.provisioning'), t('admin.auth.enabled'), t('admin.auth.actions')]}>
          {items.map((provider) => (
            <tr key={provider.id}>
              <td><code>{provider.slug}</code></td>
              <td>{provider.displayName}</td>
              <td>{provider.issuerUrl}</td>
              <td>{provider.provisioning === 'auto' ? t('admin.auth.provisioningAuto') : t('admin.auth.provisioningAllowlist')}</td>
              <td><Badge tone={provider.enabled ? 'info' : 'neutral'}>{provider.enabled ? t('admin.auth.on') : t('admin.auth.off')}</Badge></td>
              <td>
                <Button variant="ghost" onClick={() => { setEditing(provider); setAdding(false); }}>{t('admin.auth.edit')}</Button>
                <Button
                  variant="ghost"
                  disabled={test.isPending}
                  onClick={async () => {
                    const result = await test.mutateAsync(provider);
                    setProbe({ slug: provider.slug, text: probeSummary(result, t) });
                  }}
                >
                  {test.isPending && test.variables?.id === provider.id ? t('admin.auth.testing') : t('admin.auth.test')}
                </Button>
                <InlineConfirm
                  label={t('admin.auth.remove')}
                  question={t('admin.auth.removeQuestion')}
                  variant="ghost"
                  busy={remove.isPending && remove.variables === provider.id}
                  busyLabel={t('admin.auth.saving')}
                  onConfirm={() => remove.mutate(provider.id)}
                />
              </td>
            </tr>
          ))}
        </DataTable>
      ) : null}
      {probe ? <ActionNote tone="neutral">{`${probe.slug}：${probe.text}`}</ActionNote> : null}
      {editing === undefined && !adding ? <Button variant="primary" onClick={() => setAdding(true)}>{t('admin.auth.providerNew')}</Button> : null}
      {adding ? <ProviderForm busy={create.isPending} onSubmit={(body) => create.mutate(body)} /> : null}
      {editing === undefined ? null : (
        <>
          <ProviderForm initial={editing} busy={patch.isPending} onSubmit={(body) => patch.mutate({ id: editing.id, body })} />
          <Button variant="ghost" onClick={() => setEditing(undefined)}>{t('admin.auth.cancelEdit')}</Button>
        </>
      )}
    </Card>
  );
}
