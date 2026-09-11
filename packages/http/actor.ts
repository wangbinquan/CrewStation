import type { Context } from 'hono';
import type { AppEnv } from './identity';
import { requireUser } from './identity';

/** 用例层的调用者：网关身份头里的用户加 identity 模块回答的管理员标记。三个以上模块需要它，故放在这里。 */
export interface HttpActor {
  readonly userId: string;
  readonly isAdmin: boolean;
}

export async function actorFrom(c: Context<AppEnv>, isAdmin: (userId: string) => Promise<boolean>): Promise<HttpActor> {
  const user = requireUser(c);
  return { userId: user.userId, isAdmin: await isAdmin(user.userId) };
}
