import type { ClusterPurpose, ResourceConditionStatus, ResourceKind, StartupRecord } from '@crewstation/contracts';
import type { TaskEnvironment } from './taskEnvironment';

export interface ProjectedCondition {
  readonly type: string;
  readonly status: ResourceConditionStatus;
  readonly reason?: string;
  readonly message?: string;
  /** 发生时刻（失败的保留期从这里算，D9）；台账只会把已记的起点往早改。 */
  readonly since?: Date;
}

export interface ProjectedRecord {
  /** 工作负载记录沿用环境 ID；工作卷记录由台账生成。 */
  readonly id?: string;
  readonly kind: ResourceKind;
  readonly ref: string;
  /** 平台档位自测没有租户项目；项目镜像验证仍用请求固定的真实项目。 */
  readonly projectId?: TaskEnvironment['projectId'];
  /** 上级记录的 ID：工作负载记录沿用环境 ID，所以 Agent 执行的上级就是父工作区的环境 ID。 */
  readonly parentId?: string;
  readonly purpose?: ClusterPurpose;
  readonly children: readonly { readonly kind: string; readonly namespace: string; readonly name: string }[];
  /** 工作卷上级结束后怎么处理（设计 §6.4）：跟随容器的随之删除，持久卷留着待回收。只有工作卷有。 */
  readonly reclaim?: 'delete' | 'retain';
  readonly display: Readonly<Record<string, string>>;
  readonly conditions: readonly ProjectedCondition[];
  readonly startup?: StartupRecord;
  /** 期望「不要了」及其原因；没有就是「要」。 */
  readonly release?: { readonly code: string; readonly message: string };
  /** 旧身份（设计 §6.5）：RFC-013 之前的 `tsk_…`，写进台账的别名，按旧 ID 也能找回这条记录。 */
  readonly aliases?: readonly { readonly source: 'tsk'; readonly alias: string }[];
  /** 资源中心建出子对象要用的期望（RFC-025 I25，不含凭据）：并进记录的 spec；没有就是所属模块自己建。 */
  readonly render?: Readonly<Record<string, unknown>>;
}

export interface EnvironmentProjection {
  readonly workload: ProjectedRecord;
  readonly volume?: ProjectedRecord;
  readonly botVolume?: ProjectedRecord;
  readonly route?: ProjectedRecord;
  /** Runner 当前是否连着；是否上报「断开」要看台账里是否曾经连上（资源中心按「曾经为真」判降级）。 */
  readonly connected: boolean;
}

