import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '@crewstation/http';
import { actorFrom, parseBody, parseParams, parseQuery } from '@crewstation/http';
import type { ProjectId, UserId } from '@crewstation/contracts';
import { AuthorizeObjectStoragePlansSchema, ObjectPageQuerySchema, ObjectStoragePlanInputSchema, ProjectIdSchema, RegisterObjectBackendSchema, ResourceIdSchema, StorageMetricsQuerySchema, StorageRevisionSchema, UpdateObjectBackendSchema } from '@crewstation/contracts';
import type { ObjectStorageAdminApi } from '../api/objectStorageApi';
import { objectDownloadResponse } from './objectDownloadResponse';
import { ArchiveReceiptPageQuerySchema } from '@crewstation/contracts';
import { RotateObjectBackendCredentialSchema } from '@crewstation/contracts';

export function objectAdminRoutes(api: ObjectStorageAdminApi, isAdmin: (id: UserId) => Promise<boolean>) {
  const r = new Hono<AppEnv>();
  const actor = async (c: Context<AppEnv>) => { const a = await actorFrom(c, (id) => isAdmin(id as UserId)); return { userId: a.userId as UserId, isAdmin: a.isAdmin }; };
  const id = (c: Context<AppEnv>) => parseParams(c, z.object({ id: ResourceIdSchema })).id;
  r.get('/v3/admin/object-storage/backends', async (c) => c.json({ items: await api.backends(await actor(c)) }));
  r.post('/v3/admin/object-storage/backends', async (c) => c.json(await api.registerBackend(await actor(c), await parseBody(c, RegisterObjectBackendSchema)), 201));
  r.put('/v3/admin/object-storage/backends/:id', async (c) => c.json(await api.updateBackend(await actor(c), id(c), await parseBody(c, UpdateObjectBackendSchema))));
  r.post('/v3/admin/object-storage/backends/:id/rotate-credential', async (c) => c.json(await api.rotateCredential(await actor(c), id(c), await parseBody(c, RotateObjectBackendCredentialSchema))));
  r.get('/v3/admin/object-storage/backends/:id/observation', async (c) => c.json(await api.observation(await actor(c), { backendId: id(c) }, parseQuery(c, StorageMetricsQuerySchema).window)));
  r.get('/v3/admin/object-storage/backends/:id/blockers', async (c) => c.json(await api.blockers(await actor(c), { backendId: id(c) }, parseQuery(c, ObjectPageQuerySchema))));
  r.get('/v3/admin/object-storage/backends/:id/finalizations', async (c) => c.json(await api.archiveHistory(await actor(c), { backendId: id(c) }, parseQuery(c, ObjectPageQuerySchema))));
  r.get('/v3/admin/object-storage/plans', async (c) => c.json({ items: await api.plans(await actor(c)) }));
  r.post('/v3/admin/object-storage/plans', async (c) => c.json(await api.savePlan(await actor(c), undefined, await parseBody(c, ObjectStoragePlanInputSchema)), 201));
  r.put('/v3/admin/object-storage/plans/:id', async (c) => {
    const input = await parseBody(c, z.strictObject({ expectedRevision: StorageRevisionSchema, plan: ObjectStoragePlanInputSchema }));
    return c.json(await api.savePlan(await actor(c), id(c), input.plan, input.expectedRevision));
  });
  r.put('/v3/admin/object-storage/project-plans', async (c) => c.json(await api.authorizePlans(await actor(c), await parseBody(c, AuthorizeObjectStoragePlansSchema))));
  r.get('/v3/admin/object-storage/projects/:projectId/policy', async (c) => c.json(await api.projectPolicy(await actor(c), parseParams(c, z.object({ projectId: ProjectIdSchema })).projectId)));
  r.get('/v3/admin/object-storage/spaces', async (c) => c.json({ items: await api.spaces(await actor(c)) }));
  r.get('/v3/projects/:projectId/object-storage/spaces', async (c) => c.json({ items: await api.spaces(await actor(c), parseParams(c, z.object({ projectId: ProjectIdSchema })).projectId as ProjectId) }));
  r.get('/v3/projects/:projectId/object-storage/plans', async (c) => c.json({ items: await api.plans(await actor(c), parseParams(c, z.object({ projectId: ProjectIdSchema })).projectId as ProjectId) }));
  r.get('/v3/object-storage/spaces/:id/observation', async (c) => c.json(await api.observation(await actor(c), { spaceId: id(c) }, parseQuery(c, StorageMetricsQuerySchema).window)));
  r.get('/v3/object-storage/spaces/:id/blockers', async (c) => c.json(await api.blockers(await actor(c), { spaceId: id(c) }, parseQuery(c, ObjectPageQuerySchema))));
  r.get('/v3/object-storage/spaces/:id/finalizations', async (c) => c.json(await api.archiveHistory(await actor(c), { spaceId: id(c) }, parseQuery(c, ObjectPageQuerySchema))));
  r.get('/v3/object-storage/spaces/:id/objects', async (c) => c.json(await api.objects(await actor(c), id(c), parseQuery(c, ObjectPageQuerySchema))));
  r.get('/v3/object-storage/objects/:id', async (c) => c.json(await api.object(await actor(c), id(c))));
  r.get('/v3/object-storage/finalizations/:id/receipt-items', async (c) => c.json(await api.receiptItems(await actor(c), id(c), parseQuery(c, ArchiveReceiptPageQuerySchema))));
  r.get('/v3/object-storage/objects/:id/content', async (c) => {
    const range = c.req.header('range');
    return objectDownloadResponse(await api.download(await actor(c), id(c), { signal: c.req.raw.signal, ...(range ? { range } : {}) }));
  });
  return r;
}

export function objectMetricsExporter(render: () => string, token: string) {
  const r = new Hono<AppEnv>();
  r.get('/internal/object-storage/metrics', (c) => {
    const expected = Buffer.from(`Bearer ${token}`), supplied = Buffer.from(c.req.header('authorization') ?? '');
    if (!token || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return c.text('Unauthorized', 401);
    return c.text(render(), 200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
  });
  return r;
}
