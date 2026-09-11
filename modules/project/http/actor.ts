import type { Actor, UserId } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { requireUser } from '@crewstation/http';
import type { Context } from 'hono';
import type { ProjectModuleApi } from '../api/moduleApi';

/** 从网关注入的用户身份得到用例层 Actor；管理员标记经 api.isAdmin 查询。 */
export async function actorFrom(c: Context<AppEnv>, api: Pick<ProjectModuleApi, 'isAdmin'>): Promise<Actor> {
  const user = requireUser(c);
  const userId = user.userId as UserId;
  return { userId, isAdmin: await api.isAdmin(userId) };
}
