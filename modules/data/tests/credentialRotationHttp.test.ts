import { expect, test } from 'bun:test';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { noopLogger } from '@crewstation/kernel';
import type { DataModuleApi } from '../api/moduleApi';
import type { DataUseCaseDeps } from '../application/dependencies';
import { rotateCredentialUseCase } from '../application/rotateCredential';
import { dataRoutes } from '../http/dataRoutes';

test('轮换 HTTP：未登录 401、成员 403、缺确认词 400；管理员只收到数据资源 DTO', async () => {
  const id = '01a0bf5d-8f4b-76c5-866c-f1feda3d64a1';
  let rotated = 0;
  const deps = { logger: noopLogger, resources: { getById: async () => ({ id, projectId: id, kind: 'postgres', state: 'ready', env: 'development', plan: 'small', envVar: 'CS_DATABASE_URL', createdAt: new Date() }) },
    provisioning: { credentials: { rotateCredential: async () => { rotated += 1; } } },
  } as unknown as DataUseCaseDeps;
  const app = createApp({ name: 'data-rotate-test' });
  app.route('/', dataRoutes({ rotateCredential: rotateCredentialUseCase(deps) } as DataModuleApi, async (userId) => userId === id));
  const post = (user?: string, confirmation = 'rotate') => app.request(`/v1/data/resources/${id}/rotate-credential`, { method: 'POST', headers: { 'content-type': 'application/json', ...(user ? { [IDENTITY_HEADERS.userId]: user } : {}) }, body: JSON.stringify({ confirmation }) });
  expect((await post()).status).toBe(401);
  expect((await post('01a0bf5d-8f4b-76c5-866c-f1feda3d64a2')).status).toBe(403);
  expect((await post(id, 'yes')).status).toBe(400);
  const response = await post(id);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ id, state: 'ready' });
  expect(rotated).toBe(1);
});
