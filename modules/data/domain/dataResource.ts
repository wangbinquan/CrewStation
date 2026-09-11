import type { DataEnv, DataResourceKind, DataResourceState, ProjectId, ServiceId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';

/** 每服务一份生产数据资源＋一份开发库（Design §9.1）；供给状态机与发布无关。 */
export interface DataResource {
  readonly id: string;
  readonly projectId: ProjectId;
  readonly serviceId: ServiceId;
  readonly kind: DataResourceKind;
  readonly env: DataEnv;
  readonly plan: string;
  readonly state: DataResourceState;
  /** 注入容器的环境变量名（两个环境同名，值不同）。 */
  readonly envVar: string;
  /** 平台侧对象名（数据库名、角色名、Bucket 名、PVC 名）。 */
  readonly objectName: string;
  /** 加密后的连接串；只在渲染环境变量时解密。 */
  readonly secretBox?: string;
  readonly message?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const NEXT: Record<DataResourceState, readonly DataResourceState[]> = {
  requested: ['provisioning', 'failed'],
  provisioning: ['ready', 'failed'],
  ready: ['releasing'],
  failed: ['provisioning', 'releasing'],
  releasing: ['released', 'failed'],
  released: [],
};

export function transition(resource: DataResource, state: DataResourceState, now: Date, patch: Partial<DataResource> = {}): DataResource {
  if (!NEXT[resource.state].includes(state)) throw precondition(`数据资源 ${resource.objectName} 不能从 ${resource.state} 进入 ${state}`);
  return { ...resource, ...patch, state, updatedAt: now };
}

/** 对象名只含小写与下划线，长度受 PostgreSQL 63 字节限制。 */
export function postgresObjectName(projectSlug: string, env: DataEnv): string {
  const base = projectSlug.replace(/-/g, '_').slice(0, 40);
  return env === 'production' ? `cs_${base}` : `cs_${base}_dev`;
}

export const ENV_VAR_BY_KIND: Record<DataResourceKind, string> = {
  postgres: 'CS_DATABASE_URL',
  s3: 'CS_S3_URL',
  pvc: 'CS_FILES_PATH',
};
