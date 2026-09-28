import type { ReactElement } from 'react';
import { AdminOverviewPage } from '../../features/admin';
import { ClusterOverviewStrip } from '../../features/cluster';
import { ObjectStorageOverview } from '../../features/object-storage';

/** /admin 管理总览：集群状态、对象存储摘要、待处理事项与管理入口。 */
export function AdminOverview(): ReactElement {
  return <AdminOverviewPage status={<><ClusterOverviewStrip /><ObjectStorageOverview /></>} />;
}
