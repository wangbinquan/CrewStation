import type { WorkloadIdentity } from '@crewstation/contracts';

/** identity 模块验签并现查 Pod 索引；不接受业务请求自报的版本、槽、Pod UID。 */
export interface BusinessExecutionSourceResolver {
  resolve(token: string): Promise<(WorkloadIdentity & { source: NonNullable<WorkloadIdentity['source']> }) | undefined>;
}
