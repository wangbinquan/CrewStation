import type { ReactElement } from 'react';
import { AdminOverviewPage } from '../../features/admin';
import { ClusterOverviewStrip } from '../../features/cluster';
import { ObjectStorageOverview } from '../../features/object-storage';

/** /admin 管理总览：集群状态、待处理事项与管理入口；对象存储摘要替换同一网格中的入口卡片。 */
export function AdminOverview(): ReactElement {
  return <AdminOverviewPage status={<ClusterOverviewStrip />} entryCards={{ '/admin/object-storage': <ObjectStorageOverview /> }} />;
}
