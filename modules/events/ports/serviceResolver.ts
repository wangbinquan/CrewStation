import type { ProjectId, ServiceId } from '@crewstation/contracts';

/** 服务的归属信息；由 project 模块提供，无 actor，只在事件消费等受信路径使用。 */
export interface ResolvedService {
  readonly projectId: ProjectId;
  readonly serviceId: ServiceId;
  /** 项目 slug；投递信封里的 source.project。 */
  readonly slug: string;
  /** 服务身份 `<project>/<service>`；produce 时与网关注入的来源身份核对。 */
  readonly identity: string;
}

export interface ServiceResolver {
  resolveService(serviceId: ServiceId): Promise<ResolvedService | undefined>;
}
