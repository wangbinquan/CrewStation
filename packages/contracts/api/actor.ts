import type { UserId } from '../ids';

/** 用例层的调用者：由 http 层从网关注入的身份加 identity 模块的管理员标记得到。 */
export interface Actor {
  readonly userId: UserId;
  readonly isAdmin: boolean;
}

/** 以服务身份调用平台 API 的调用者（业务服务创建业务任务等）。 */
export interface ServiceActor {
  readonly identity: string;
  readonly project: string;
  readonly service: string;
  readonly slot?: string;
}
