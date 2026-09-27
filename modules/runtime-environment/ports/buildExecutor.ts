import type { ImageBuild, ImageRevision } from '../domain/records';
import type { InspectedImage } from './registry';

export interface BuildArtifactReceipt {
  readonly buildId: string;
  readonly executionEpoch: number;
  readonly podUid: string;
  readonly reference: string;
}
export interface BuildObservation {
  readonly state: 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown' | 'stopped';
  readonly resourceId: string;
  /** 从 Kubernetes 可信观测取得，不从构建脚本输出的 JSON 取得。 */
  readonly podUid?: string;
  readonly receipt?: BuildArtifactReceipt;
  readonly error?: string;
  readonly logs?: { readonly cursor: string; readonly lines: readonly string[] };
}
export interface RuntimeImageBuildExecutor {
  /**
   * 资源台账接收持久控制 epoch；忽略旧 epoch，stop 一旦受理不可退回 run。
   * 对同一 build 幂等声明，重启后接管原资源；没有原 Pod 不能自动另建一个执行副作用。
   * stopped 必须证明原 builder/client Pod UID 均消失且短期 Secret／卷已回收。
   */
  reconcile(build: ImageBuild, revision: ImageRevision, desired: 'run' | 'stop'): Promise<BuildObservation>;
  /** 平台从固定的本 build 目标仓库重读产物，不信任 receipt 里任意 image 地址。 */
  inspect(build: ImageBuild, revision: ImageRevision, receipt?: BuildArtifactReceipt): Promise<{ image: InspectedImage; base?: InspectedImage }>;
}
