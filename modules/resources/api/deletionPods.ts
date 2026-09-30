import type { ProjectDeletionContext } from '@crewstation/contracts';

/** 只保存原实例与不可逆停止的摘要；不保留容器配置、业务输出或凭据。 */
export interface ProjectPodStopReceipt {
  readonly key: string;
  readonly uid: string;
  readonly nodeUid: string | null;
  readonly digest: string;
  readonly observedAt: string;
}
export interface ProjectPodStopReceipts {
  get(context: ProjectDeletionContext, key: string, uid: string): Promise<ProjectPodStopReceipt | undefined>;
  save(context: ProjectDeletionContext, receipt: ProjectPodStopReceipt): Promise<void>;
}
