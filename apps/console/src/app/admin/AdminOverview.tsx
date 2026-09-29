import type { ReactElement } from 'react';
import { AdminOverviewPage } from '../../features/admin';
import { ClusterOverviewStrip } from '../../features/cluster';
import { ObjectStorageOverview } from '../../features/object-storage';

/** /admin 管理总览：对象存储作为顶部集群状态中的容量指标小卡片，由 app 组合 feature。 */
export function AdminOverview(): ReactElement {
  return <AdminOverviewPage status={<ClusterOverviewStrip capacityTile={<ObjectStorageOverview />} />} />;
}
