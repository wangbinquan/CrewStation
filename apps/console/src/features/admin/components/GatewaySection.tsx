import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { formatDateTime } from '../../../shared/lib/dateFormat';
import { useI18n } from '../../../shared/lib/useI18n';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { GatewayRoutesTable } from './GatewayRoutesTable';
import { MutationError, SectionStatus } from './SectionStatus';
import styles from './GatewaySection.module.css';

// queryKeys 里还没有网关的键（路由与放行表是只读的派生状态），这里就地用 gateway 前缀。
const ROUTES_KEY = ['gateway', 'routes'] as const;
const ALLOWLIST_KEY = ['gateway', 'allowlist'] as const;

/** 网关状态：路由表、放行表版本与手动重算。 */
export function GatewaySection(): ReactElement {
  const t = useT();
  const { locale } = useI18n();
  const routes = useApiQuery(ROUTES_KEY, () => api.gateway.listRoutes());
  const allowlist = useApiQuery(ALLOWLIST_KEY, () => api.gateway.allowlist());
  const reconcile = useApiMutation(() => api.gateway.reconcile(), { invalidate: [['gateway']] });
  const services = routes.data?.items ?? [];
  const facts: readonly { readonly label: string; readonly value: string }[] = [
    { label: t('admin.gateway.allowlistVersion'), value: String(allowlist.data?.version ?? t('admin.none')) },
    { label: t('admin.gateway.allowlistEntries'), value: String(allowlist.data?.entries.length ?? 0) },
    { label: t('admin.gateway.defaultOpen'), value: String(allowlist.data?.defaultOpen.length ?? 0) },
    { label: t('admin.gateway.generatedAt'), value: allowlist.data?.generatedAt === undefined ? t('admin.none') : formatDateTime(allowlist.data.generatedAt, locale) },
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
      <SectionStatus
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
