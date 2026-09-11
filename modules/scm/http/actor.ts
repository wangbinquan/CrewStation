import type { Actor, UserId } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { requireUser } from '@crewstation/http';
import type { Context } from 'hono';
import type { ActorResolver } from '../api/moduleApi';

/** 从网关注入的用户身份得到用例层 Actor；管理员标记由 wiring 注入的解析器（project 模块）给出。 */
export function actorFrom(c: Context<AppEnv>, resolve: ActorResolver): Promise<Actor> {
  return resolve(requireUser(c).userId as UserId);
}
