import { afterAll, beforeAll, expect, test } from 'bun:test';
import { PlatformClient } from './platform';

let server: ReturnType<typeof Bun.serve>, client: PlatformClient;
let role: 'user' | 'developer' | 'admin' = 'user';
let missing = false, conflict = false;
const requests: { method: string; path: string; body: unknown; cookie: string | null }[] = [];

beforeAll(() => {
  server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: async (request) => {
    const path = new URL(request.url).pathname;
    const body = request.method === 'POST' || request.method === 'PUT' ? await request.json() : undefined;
    requests.push({ method: request.method, path, body, cookie: request.headers.get('cookie') });
    if (path === '/auth/login') return new Response(null, { status: 303, headers: { 'set-cookie': 'cs_session=test-admin; Path=/; HttpOnly', location: '/' } });
    if (path === '/v1/users') return Response.json({ items: missing ? [] : [{ id: 'test-role', platformRole: role }] });
    if (path === '/v1/users/test-role/platform-role') {
      if (conflict) return Response.json({ error: { message: '角色已被其他管理员修改' } }, { status: 409 });
      role = (body as { platformRole: typeof role }).platformRole;
      return Response.json({ platformRole: role });
    }
    return new Response('unexpected route', { status: 404 });
  } });
  client = new PlatformClient({ origin: `http://127.0.0.1:${server.port}`, host: 'console.test', username: 'test-admin', password: 'test-password' });
});
afterAll(() => server?.stop(true));

test('开发登录使用应用首页作为默认回跳，角色变更携带最新角色作比较', async () => {
  const cookie = await client.loginAdmin();
  expect(cookie).toBe('cs_session=test-admin');
  expect(requests.at(-1)?.body).toEqual({ username: 'test-admin', password: 'test-password', returnTo: '/' });
  await client.setPlatformRole(cookie, 'test-role', 'developer');
  expect(requests.at(-1)).toMatchObject({ method: 'PUT', path: '/v1/users/test-role/platform-role', cookie, body: { platformRole: 'developer', expectedRole: 'user' } });
  expect(role).toBe('developer');
  const writes = requests.filter((request) => request.method === 'PUT').length;
  await client.setPlatformRole(cookie, 'test-role', 'developer');
  expect(requests.filter((request) => request.method === 'PUT')).toHaveLength(writes);
});

test('账号缺失和并发角色冲突不被开发登录器伪装成成功', async () => {
  missing = true;
  await expect(client.setPlatformRole('cs_session=test-admin', 'test-role', 'user')).rejects.toThrow('开发角色用户不存在');
  missing = false; conflict = true;
  await expect(client.setPlatformRole('cs_session=test-admin', 'test-role', 'user')).rejects.toThrow('409 /v1/users/test-role/platform-role：角色已被其他管理员修改');
  expect(role).toBe('developer');
});
