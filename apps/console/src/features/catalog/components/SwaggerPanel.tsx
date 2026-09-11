import type { ApiProxyDto } from '@crewstation/contracts';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { SwaggerSpecView } from './SwaggerSpecView';
import styles from './SwaggerPanel.module.css';

export interface SwaggerPanelProps {
  readonly serviceId: string;
  readonly proxies: readonly ApiProxyDto[];
}

/** 代理选择器＋内嵌 Swagger；文档由服务端按本服务可调范围裁剪。 */
export function SwaggerPanel({ serviceId, proxies }: SwaggerPanelProps): ReactElement {
  const t = useT();
  const [proxy, setProxy] = useState('');
  const spec = useApiQuery(queryKeys.openapiSpec(serviceId, proxy), () => api.apiCatalog.openapi(proxy, { serviceId }), { enabled: proxy.length > 0 });
  return (
    <Card title={t('catalog.swagger.title')}>
      <p className={styles.notice}>{t('catalog.swagger.tryItOutDisabled')}</p>
      <p className={styles.muted}>{t('catalog.swagger.serversNote')}</p>
      {proxies.length === 0 ? (
        <p className={styles.muted}>{t('catalog.swagger.empty')}</p>
      ) : (
        <label className={styles.picker}>
          <span className={styles.label}>{t('catalog.swagger.proxy')}</span>
          <select className={styles.select} value={proxy} onChange={(e) => setProxy(e.target.value)}>
            <option value="">{t('catalog.swagger.selectHint')}</option>
            {proxies.map((entry) => (
              <option key={entry.proxy} value={entry.proxy}>
                {entry.proxy}
              </option>
            ))}
          </select>
        </label>
      )}
      {/* 没选代理时查询是禁用的，isPending 会一直为真，所以先看有没有选中。 */}
      <QueryStatus isPending={proxy.length > 0 && spec.isPending} error={spec.error} loadingKey="catalog.swagger.loading" errorKey="catalog.error.load" />
      {spec.data !== undefined ? <SwaggerSpecView key={proxy} spec={spec.data} /> : null}
    </Card>
  );
}
