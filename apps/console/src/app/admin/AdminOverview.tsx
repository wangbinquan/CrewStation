import type { ReactElement } from 'react';
import { AdminOverviewPage } from '../../features/admin';
import { ClusterOverviewStrip } from '../../features/cluster';

/** /admin 管理总览：集群状态条在最上面（2026-09-23 作者裁定，从集群管理挪来），其下是待处理事项与管理入口。 */
export function AdminOverview(): ReactElement {
  return <AdminOverviewPage status={<ClusterOverviewStrip />} />;
}
