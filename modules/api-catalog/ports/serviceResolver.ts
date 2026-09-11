import type { ProjectId, ServiceId } from '@crewstation/contracts';

/** 服务的归属信息；由 project 模块提供，无 actor，只在受信路径（事件消费、网关查表、已鉴权用例内部）使用。 */
export interface ResolvedService {
  readonly projectId: ProjectId;
  readonly serviceId: ServiceId;
  /** 项目 slug；数字人自有 API 以它为 proxy 名。 */
  readonly slug: string;
  /** 服务身份 `<project>/<service>`，网关按它查放行表。 */
  readonly identity: string;
}

export interface ServiceResolver {
  resolveService(serviceId: ServiceId): Promise<ResolvedService | undefined>;
  resolveServiceIdentity(identity: string): Promise<ResolvedService | undefined>;
}
