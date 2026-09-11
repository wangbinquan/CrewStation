import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useDateText } from '../../../shared/lib/useDateText';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { GatewayRoutesTable } from './GatewayRoutesTable';
import { MutationError } from './MutationError';
import styles from './GatewaySection.module.css';

/** 网关状态：路由表、放行表版本与手动重算。 */
export function GatewaySection(): ReactElement {
  const t = useT();
  const dateText = useDateText();
  const routes = useApiQuery(queryKeys.gatewayRoutes(), () => api.gateway.listRoutes());
  const allowlist = useApiQuery(queryKeys.gatewayAllowlist(), () => api.gateway.allowlist());
  // 重算同时改路由表与放行表，按 gateway 前缀一次失效两份。
  const reconcile = useApiMutation(() => api.gateway.reconcile(), { invalidate: [queryKeys.gateway()] });
  const services = routes.data?.items ?? [];
  const facts: readonly { readonly label: string; readonly value: string }[] = [
    { label: t('admin.gateway.allowlistVersion'), value: String(allowlist.data?.version ?? t('admin.none')) },
    { label: t('admin.gateway.allowlistEntries'), value: String(allowlist.data?.entries.length ?? 0) },
    { label: t('admin.gateway.defaultOpen'), value: String(allowlist.data?.defaultOpen.length ?? 0) },
    { label: t('admin.gateway.generatedAt'), value: allowlist.data?.generatedAt === undefined ? t('admin.none') : dateText(allowlist.data.generatedAt) },
    { label: t('admin.gateway.maxStale'), value: String(allowlist.data?.maxStaleSeconds ?? t('admin.none')) },
  ];
  return (
    <Card title={t('admin.gateway.title')} footer={t('admin.gateway.hint')}>
      <MutationError error={reconcile.error} messageKey="admin.gateway.reconcileError" />
      <div className={styles.actions}>
        <Button variant="primary" disabled={reconcile.isPending} onClick={() => reconcile.mutate(undefined)}>
          {reconcile.isPending ? t('admin.gateway.reconciling') : t('admin.gateway.reconcile')}
        </Button>
        {reconcile.data === undefined ? null : (
          <span className={styles.result} role="status">
            {t('admin.gateway.reconciled', { routes: reconcile.data.routes, allowlist: reconcile.data.allowlist })}
          </span>
        )}
      </div>
      <dl className={styles.facts}>
        {facts.map((fact) => (
          <div key={fact.label} className={styles.fact}>
            <dt className={styles.factLabel}>{fact.label}</dt>
            <dd className={styles.factValue}>{fact.value}</dd>
          </div>
        ))}
      </dl>
      <p className={styles.subtitle}>{t('admin.gateway.routesTitle')}</p>
      <QueryStatus
        isPending={routes.isPending}
        error={routes.error}
        isEmpty={services.length === 0}
        emptyTitle={t('admin.gateway.emptyTitle')}
        emptyDescription={t('admin.gateway.emptyDescription')}
      />
      {services.length > 0 ? <GatewayRoutesTable services={services} /> : null}
    </Card>
  );
}
