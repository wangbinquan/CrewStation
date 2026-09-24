import type { Actor, AdoptionReport } from '@crewstation/contracts';

/** 服务槽的期望（release 写进槽记录的那一份：子对象与 slot 渲染输入，RFC-025 T8）。 */
export type SlotSpec = {
  readonly children: readonly { readonly kind: string; readonly namespace?: string; readonly name: string }[];
  readonly slot: Readonly<Record<string, unknown>>;
};

/** cluster-control 模块对外能力（RFC-025 第一期：观测与收编空跑报告；T8：服务槽的集群预检）。 */
export interface ClusterControlModuleApi {
  readonly name: 'cluster-control';
  /** 管理员：收编空跑报告，只读，不改集群也不写台账。 */
  adoptionReport(actor: Actor): Promise<AdoptionReport>;
  /**
   * 统一预检的集群一步（设计 §5）：按槽的期望渲染出与调和器相同的环境 Secret、Service 与 Deployment，以服务端 dry-run 提交一次，不改集群；
   * 期望不完整抛 validation，API Server 拒绝时抛出它给的原因。values 是这一次部署的环境，只在内存里用。
   */
  dryRunSlot(spec: SlotSpec, values: Readonly<Record<string, string>>): Promise<void>;
}
