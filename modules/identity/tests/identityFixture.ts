import type { UserId } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { createApp } from '@crewstation/http';
import { newId } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import type { Hono } from 'hono';
import { bunPasswordHasher } from '../adapters/password/bunPasswordHasher';
import { drizzleLoginPolicyRepository } from '../adapters/persistence/drizzleOidcRepositories';
import { drizzleUserRepository } from '../adapters/persistence/drizzleUserRepository';
import type { IdentityModule, IdentityModuleDeps } from '../wiring';
import { createIdentityModule } from '../wiring';

/** 测试里统一的本地口令：长度满足契约下限，内容无意义。 */
export const TEST_PASSWORD = 'test-password-1234';

export const BASE_SETTINGS = {
  adminEmails: [] as string[],
  userDomain: 'cs.localhost',
  cookieDomain: '.cs.localhost',
  secure: false,
  sessionTtlSeconds: 3600,
  secretKey: Buffer.alloc(32, 7).toString('base64'),
  bootstrapToken: 'test-bootstrap-token',
};

export function mountRouters(module: IdentityModule, groups: ReadonlyArray<'auth' | 'forwardAuth' | 'users' | 'devSessionGate'>): Hono<AppEnv> {
  const hono = createApp({ name: 'test' });
  for (const group of groups) for (const router of module.http[group]) hono.route('/', router);
  return hono;
}

export function identityModuleFor(db: Database, overrides: Partial<IdentityModuleDeps> = {}): IdentityModule {
  return createIdentityModule({ db, settings: { ...BASE_SETTINGS, ...overrides.settings }, ...overrides });
}

/** 把引导标记成已完成：除了专门测引导的用例，其他用例都从「已有管理员」的状态开始。 */
export async function completeBootstrap(db: Database): Promise<void> {
  await drizzleLoginPolicyRepository(db).completeBootstrap(new Date());
}

/**
 * 直接经仓储播种一个带本地口令的账户。
 * 走仓储而不是某个「建用户」接口，是因为产品里本地账户只有引导管理员一条来源（RFC-005 §7）；
 * 测试需要多个账户，但不该为此在对外 API 上开一个建账户的口子。
 */
export async function seedLocalUser(db: Database, input: { username: string; name?: string; email?: string; isAdmin?: boolean; gitName?: string | null }): Promise<UserId> {
  const id = newId('usr') as UserId;
  const now = new Date();
  await drizzleUserRepository(db).insert({
    id,
    externalId: `local:${input.username}`,
    username: input.username,
    name: input.name ?? input.username,
    email: input.email ?? `${input.username}@corp.example`,
    gitName: input.gitName ?? null,
    passwordHash: await bunPasswordHasher().hash(TEST_PASSWORD),
    platformRole: input.isAdmin ? 'admin' : 'user',
    createdAt: now,
    lastLoginAt: now,
  });
  return id;
}

export interface LoggedIn {
  readonly cookie: string;
  readonly userId: UserId;
}

/** 走真实的 `POST /auth/login`：测试里出现的会话必须是产品路径签出来的。 */
export async function loginWithPassword(app: Hono<AppEnv>, module: IdentityModule, username: string, password = TEST_PASSWORD): Promise<LoggedIn> {
  const response = await app.request('/auth/login', { method: 'POST', body: new URLSearchParams({ username, password }) });
  const cookie = /cs_session=([^;]*)/.exec(response.headers.get('set-cookie') ?? '')?.[1] ?? '';
  const user = await module.api.resolveSession(cookie);
  if (!user) throw new Error(`登录失败：${response.status} ${await response.text()}`);
  return { cookie, userId: user.id };
}
