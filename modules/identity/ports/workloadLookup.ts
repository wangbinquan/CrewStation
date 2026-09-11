import type { WorkloadIdentity } from '@crewstation/contracts';

/** 源 Pod IP → 工作负载身份（Design §7.2）；索引由 gateway 模块维护并经装配注入。 */
export interface WorkloadLookup {
  byIp(ip: string): Promise<WorkloadIdentity | undefined>;
}
