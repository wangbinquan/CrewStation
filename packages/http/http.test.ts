import { describe, expect, test } from 'bun:test';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { z } from 'zod';
import { createApp } from './createApp';
import { requireService, requireUser } from './identity';
import { parseBody } from './validate';

describe('http 骨架', () => {
  const app = createApp({ name: 'test' });
  app.get('/me', (c) => c.json(requireUser(c)));
  app.get('/svc', (c) => c.json(requireService(c)));
  app.post('/echo', async (c) => c.json(await parseBody(c, z.object({ n: z.number() }))));

  test('健康检查', async () => {
    const res = await app.request('/healthz');
    expect(await res.json()).toEqual({ ok: true, service: 'test' });
  });
  test('用户身份来自网关头，缺失即 401', async () => {
    expect((await app.request('/me')).status).toBe(401);
    const res = await app.request('/me', { headers: { [IDENTITY_HEADERS.userId]: 'usr_1', [IDENTITY_HEADERS.userName]: 'Ada' } });
    expect(await res.json()).toMatchObject({ kind: 'user', userId: 'usr_1', name: 'Ada' });
  });
  test('服务身份解析 project/service', async () => {
    const res = await app.request('/svc', { headers: { [IDENTITY_HEADERS.sourceService]: 'demo/worker', [IDENTITY_HEADERS.sourceSlot]: 'prod' } });
    expect(await res.json()).toMatchObject({ kind: 'service', project: 'demo', service: 'worker', slot: 'prod' });
    expect((await app.request('/svc', { headers: { [IDENTITY_HEADERS.userId]: 'usr_1' } })).status).toBe(403);
  });
  test('请求体校验失败返回 400 与 issues', async () => {
    const res = await app.request('/echo', { method: 'POST', body: JSON.stringify({ n: 'x' }), headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'validation' });
  });
});
