import type { Manifest, ServicePlanDto } from '@crewstation/contracts';
import type { PhysicalSlot } from '../domain/slots';

export type JobState = { state: 'running' } | { state: 'succeeded' } | { state: 'failed'; message: string };

/** 构建：从仓库标签构建镜像并推送到平台注册表；实现为 BuildKit Job。 */
export interface ImageBuilder {
  start(spec: { releaseId: string; namespace: string; repoHttpUrl: string; credentialSecretName: string; ref: string; image: string }): Promise<{ buildRef: string }>;
  status(buildRef: string, namespace: string): Promise<JobState>;
}

/** 迁移：在生产库上执行 Manifest 声明的迁移命令；实现为一次性 Job。 */
export interface MigrationRunner {
  start(spec: { releaseId: string; namespace: string; image: string; command: string[]; env: Record<string, string> }): Promise<{ migrationRef: string }>;
  status(migrationRef: string, namespace: string): Promise<JobState>;
}

export interface SlotDeploySpec {
  namespace: string;
  projectSlug: string;
  serviceName: string;
  physical: PhysicalSlot;
  releaseId: string;
  image: string;
  manifest: Manifest;
  replicas?: number;
  env: Record<string, string>;
  plan: ServicePlanDto;
}

export interface SlotStatus {
  replicas: number;
  readyReplicas: number;
  state: 'deploying' | 'ready' | 'degraded' | 'failed';
  message?: string;
}

/** 部署：一个物理槽对应一个 Deployment 与一个 Service，名字 `<service>-<physical>`。 */
export interface SlotDeployer {
  deploy(spec: SlotDeploySpec): Promise<void>;
  status(namespace: string, serviceName: string, physical: PhysicalSlot): Promise<SlotStatus>;
  remove(namespace: string, serviceName: string, physical: PhysicalSlot): Promise<void>;
}

export interface ReleaseJobs {
  /** 流水线推进任务；dedupKey 防止同一步骤重复入队。 */
  enqueuePipelineStep(releaseId: string, step: number, delaySeconds: number): Promise<void>;
}
