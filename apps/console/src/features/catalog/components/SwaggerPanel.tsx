import type { ApiProxyDto } from '@crewstation/contracts';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { ConfirmationPanel } from '../../../shared/ui/ConfirmationPanel';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { SwaggerDocument } from './SwaggerDocument';
import type { SwaggerInvocationContext } from './invocation/swaggerInvocationPlugin';
import styles from './SwaggerPanel.module.css';

export interface SwaggerPanelProps {
  readonly serviceId: string;
  readonly proxies: readonly ApiProxyDto[];
  readonly initialProxy?: string;
  readonly invocation: Omit<SwaggerInvocationContext, 'documentReady'>;
}

/** 代理选择器＋内嵌 Swagger；文档由服务端按本服务可调范围裁剪。 */
export function SwaggerPanel({ serviceId, proxies, initialProxy, invocation }: SwaggerPanelProps): ReactElement {
  const t = useT();
  const [proxy, setProxy] = useState(initialProxy ?? ''), [revision, setRevision] = useState(0), [replacement, setReplacement] = useState<string>();
  const spec = useApiQuery(queryKeys.openapiSpec(serviceId, proxy), () => api.apiCatalog.openapi(proxy, { serviceId }), { enabled: proxy.length > 0 });
  const dirtySources = invocation.controller.dirtySources.filter((source) => source.startsWith(`swagger:${proxy}:`));
  const choose = (next: string) => { for (const source of dirtySources) invocation.controller.clearDirty(source); setProxy(next); setRevision((value) => value + 1); setReplacement(undefined); };
  const requestChange = (next: string) => { if (dirtySources.length > 0) setReplacement(next); else choose(next); };
  return (
    <Card compact title={t('catalog.swagger.title')}>
      <p className={styles.notice}>{t(invocation.canDevelop ? 'catalog.swagger.tryItOutEnabled' : 'catalog.swagger.readOnly')}</p>
      <p className={styles.muted}>{t('catalog.swagger.serversNote')}</p>
      {proxies.length === 0 ? (
        <p className={styles.muted}>{t('catalog.swagger.empty')}</p>
      ) : (
        <label className={styles.picker}>
          <span className={styles.label}>{t('catalog.swagger.proxy')}</span>
          <select className={styles.select} value={proxy} disabled={invocation.controller.pending || invocation.controller.checking} onChange={(e) => requestChange(e.target.value)}>
            <option value="">{t('catalog.swagger.selectHint')}</option>
            {proxies.map((entry) => (
              <option key={entry.proxy} value={entry.proxy}>
                {entry.proxy}
              </option>
            ))}
          </select>
        </label>
      )}
      {proxy ? <div className={styles.controls}><Button disabled={spec.isFetching} onClick={() => { void spec.refetch(); }}>{t('catalog.swagger.checkDocument')}</Button><Button disabled={!spec.data || !!spec.error || spec.isFetching || invocation.controller.pending || invocation.controller.checking} onClick={() => requestChange(proxy)}>{t('catalog.swagger.reloadDocument')}</Button></div> : null}
      {replacement !== undefined ? <ConfirmationPanel question={t('catalog.swagger.replaceQuestion', { proxy })} hint={t('catalog.swagger.replaceHint')} confirmLabel={t('catalog.invoke.replace')} cancelLabel={t('catalog.invoke.keep')} busy={invocation.controller.pending || invocation.controller.checking} onConfirm={() => choose(replacement)} onCancel={() => setReplacement(undefined)} /> : null}
      {/* 没选代理时查询是禁用的，isPending 会一直为真，所以先看有没有选中。 */}
      <QueryStatus isPending={proxy.length > 0 && spec.isPending} error={spec.error} loadingKey="catalog.swagger.loading" errorKey="catalog.error.load" />
      {spec.data !== undefined ? <SwaggerDocument key={`${proxy}:${revision}`} spec={spec.data} proxy={proxy} invocation={invocation} readFailed={!!spec.error} /> : null}
    </Card>
  );
}
