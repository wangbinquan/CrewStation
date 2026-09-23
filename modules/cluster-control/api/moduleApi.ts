import type { Actor, AdoptionReport } from '@crewstation/contracts';

/** cluster-control 模块对外能力（RFC-025 第一期：观测与收编空跑报告）。 */
export interface ClusterControlModuleApi {
  readonly name: 'cluster-control';
  /** 管理员：收编空跑报告，只读，不改集群也不写台账。 */
  adoptionReport(actor: Actor): Promise<AdoptionReport>;
}
