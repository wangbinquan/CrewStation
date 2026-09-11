import type { GatewayServiceRoutes } from '@crewstation/api-client';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { DataTable } from '../../../shared/ui/DataTable';

/** 路由表按服务分组下发，这里摊平成一行一条，便于按 Host 查。 */
export function GatewayRoutesTable({ services }: { readonly services: readonly GatewayServiceRoutes[] }): ReactElement {
  const t = useT();
  const columns = [
    t('admin.gateway.service'), t('admin.gateway.host'), t('admin.gateway.pathPrefix'),
    t('admin.gateway.domain'), t('admin.gateway.kind'), t('admin.gateway.target'), t('admin.gateway.middlewares'),
  ];
  const rows = services.flatMap((service) => service.routes.map((route) => ({ serviceName: service.serviceName, route })));
  return (
    <DataTable columns={columns}>
      {rows.map(({ serviceName, route }) => (
        <tr key={`${serviceName}|${route.host}|${route.pathPrefix ?? ''}|${route.kind}`}>
          <td>
            <code>{serviceName}</code>
          </td>
          <td>
            <code>{route.host}</code>
          </td>
          <td>{route.pathPrefix === undefined ? t('admin.none') : <code>{route.pathPrefix}</code>}</td>
          <td>
            <Badge tone={route.domain === 'user' ? 'info' : 'neutral'}>{route.domain === 'user' ? t('admin.gateway.domainUser') : t('admin.gateway.domainService')}</Badge>
          </td>
          <td>{route.kind}</td>
          <td>
            <code>{`${route.target.namespace}/${route.target.service}:${route.target.port}`}</code>
          </td>
          <td>{route.middlewares.length === 0 ? t('admin.none') : route.middlewares.join(', ')}</td>
        </tr>
      ))}
    </DataTable>
  );
}
