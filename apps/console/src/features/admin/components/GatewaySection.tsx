import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useDateText } from '../../../shared/lib/useDateText';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { readAllowlistFacts, readServiceRoutes } from '../model/gatewayStatus';
import type { AllowlistFacts } from '../model/gatewayStatus';
import { GatewayRoutesTable } from './GatewayRoutesTable';
import { MutationError } from './MutationError';
import styles from './GatewaySection.module.css';

/** 网关状态：路由表、放行表版本与手动重算。两份读取各自报告载入与失败，一份坏了不拖累另一份。 */
export function GatewaySection(): ReactElement {
  const t = useT();
  // 两个响应都先过形状检查：格式不合转成读取失败显示出来，而不是让渲染期的属性访问把整页带崩。
  const routes = useApiQuery(queryKeys.gatewayRoutes(), async () => {
    const services = readServiceRoutes(await api.gateway.listRoutes());
    if (services === undefined) throw new Error(t('admin.gateway.routesInvalid'));
    return services;
  });
  const allowlist = useApiQuery(queryKeys.gatewayAllowlist(), async () => {
    const facts = readAllowlistFacts(await api.gateway.allowlist());
    if (facts === undefined) throw new Error(t('admin.gateway.allowlistInvalid'));
    return facts;
  });
  // 重算同时改路由表与放行表，按 gateway 前缀一次失效两份。
  const reconcile = useApiMutation(() => api.gateway.reconcile(), { invalidate: [queryKeys.gateway()] });
  // 读取失败时不拿上一份数据充数：放行表「0 条」与路由表「为空」都是会被当真的结论。
  const facts = allowlist.error ? undefined : allowlist.data, services = routes.error ? undefined : routes.data;
  const reread = (): void => { if (routes.error) void routes.refetch(); if (allowlist.error) void allowlist.refetch(); };
  return (
    <Card title={t('admin.gateway.title')} footer={t('admin.gateway.hint')}>
      <MutationError error={reconcile.error} messageKey="admin.gateway.reconcileError" />
      <div className={styles.actions}>
        <Button variant="primary" disabled={reconcile.isPending} onClick={() => reconcile.mutate(undefined)}>
          {reconcile.isPending ? t('admin.gateway.reconciling') : t('admin.gateway.reconcile')}
        </Button>
        {routes.error || allowlist.error ? <Button disabled={routes.isFetching || allowlist.isFetching} onClick={reread}>{t('admin.gateway.reread')}</Button> : null}
        {reconcile.data === undefined ? null : (
          <span className={styles.result} role="status">
            {t('admin.gateway.reconciled', { routes: reconcile.data.routes, allowlist: reconcile.data.allowlist })}
          </span>
        )}
      </div>
      <QueryStatus isPending={allowlist.isPending} error={allowlist.error} />
      {facts === undefined ? null : <AllowlistFactList facts={facts} />}
      <p className={styles.subtitle}>{t('admin.gateway.routesTitle')}</p>
      <QueryStatus
        isPending={routes.isPending}
        error={routes.error}
        isEmpty={services?.length === 0}
        emptyTitle={t('admin.gateway.emptyTitle')}
        emptyDescription={t('admin.gateway.emptyDescription')}
      />
      {services !== undefined && services.length > 0 ? <GatewayRoutesTable services={services} /> : null}
    </Card>
  );
}

function AllowlistFactList({ facts }: { readonly facts: AllowlistFacts }): ReactElement {
  const t = useT();
  const dateText = useDateText();
  const rows: readonly { readonly label: string; readonly value: string }[] = [
    { label: t('admin.gateway.allowlistVersion'), value: String(facts.version) },
    { label: t('admin.gateway.allowlistEntries'), value: String(facts.entries) },
    { label: t('admin.gateway.defaultOpen'), value: String(facts.defaultOpen) },
    { label: t('admin.gateway.generatedAt'), value: facts.generatedAt === undefined ? t('admin.none') : dateText(facts.generatedAt) },
    { label: t('admin.gateway.maxStale'), value: String(facts.maxStaleSeconds ?? t('admin.none')) },
  ];
  return (
    <dl className={styles.facts}>
      {rows.map((row) => (
        <div key={row.label} className={styles.fact}>
          <dt className={styles.factLabel}>{row.label}</dt>
          <dd className={styles.factValue}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
