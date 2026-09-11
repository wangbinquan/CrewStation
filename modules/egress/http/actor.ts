import type { Actor, UserId } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { requireUser } from '@crewstation/http';
import type { Context } from 'hono';

/** 路由层需要的最小身份能力；由 wiring 用 project 模块的 isAdmin 提供。 */
export interface ActorResolver {
  isAdmin(userId: UserId): Promise<boolean>;
}

/** 从网关注入的用户身份得到用例层 Actor。 */
export async function actorFrom(c: Context<AppEnv>, resolver: ActorResolver): Promise<Actor> {
  const userId = requireUser(c).userId as UserId;
  return { userId, isAdmin: await resolver.isAdmin(userId) };
}
