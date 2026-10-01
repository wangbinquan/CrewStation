import type { ProjectId, ServiceId, UserId } from '../ids';
import type { PlatformRole } from './identity';

/** 用例层的调用者：由 http 层从网关注入的身份加 identity 模块的管理员标记得到。 */
export interface Actor {
  readonly userId: UserId;
  readonly isAdmin: boolean;
  readonly platformRole?: PlatformRole;
}

/** 以服务身份调用平台 API 的调用者（业务服务创建业务任务等）。 */
export interface ServiceActor {
  readonly identity: string;
  readonly project: string;
  readonly service: string;
  readonly slot?: string;
}

/** 平台受理前固定的原项目／服务身份；名称仍用于协议展示，不能据此重新绑定项目。 */
export interface ProjectServiceActor extends ServiceActor {
  readonly projectId: ProjectId;
  readonly serviceId: ServiceId;
}
