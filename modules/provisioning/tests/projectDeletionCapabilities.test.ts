import { expect, test } from 'bun:test';
import { IDENTITY_HEADERS, type UserId } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { projectDeletionCapabilitiesRoutes } from '../http/projectDeletionRoutes';

test.each([false, true])('deletion capability %s is an admin-only, uncached read', async available => {
  const admin = '01a0bf5d-8f4b-7178-82e1-9a99060b1192' as UserId;
  const member = '01a0bf5d-8f4b-7178-82e1-9a99060b1193' as UserId;
  const checks: string[] = [];
  const app = createApp({ name: 'deletion-capability' }).route('/', projectDeletionCapabilitiesRoutes(available, async id => { checks.push(id); return id === admin; }));
  const path = '/v1/project-deletions/capabilities';
  expect((await app.request(path)).status).toBe(401);
  expect((await app.request(path, { headers: { [IDENTITY_HEADERS.userId]: member } })).status).toBe(403);
  const response = await app.request(path, { headers: { [IDENTITY_HEADERS.userId]: admin } });
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ available }); expect(checks).toEqual([member, admin]);
  expect((await app.request(path, { method: 'POST', headers: { [IDENTITY_HEADERS.userId]: admin } })).status).toBe(404);
});
