import type { DataPlaneSnapshot } from '../domain/dataPlane';

/** 数据面的只读快照：平台数据库集群上带平台前缀的库与角色（实现在 adapters/postgres）。 */
export interface DataPlaneReader {
  snapshot(): Promise<DataPlaneSnapshot>;
  close(): Promise<void>;
}
