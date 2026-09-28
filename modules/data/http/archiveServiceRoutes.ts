import { ArchivePlanEntriesQuerySchema, ArchivePlanPageSchema, CreateArchivePlanSchema, OBJECT_STORAGE_LIMITS, ResourceIdSchema, SealArchivePlanSchema, TaskIdSchema } from '@crewstation/contracts';
import { parseParams, parseQuery, requireService } from '@crewstation/http';
import type { AppEnv } from '@crewstation/http';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { ArchiveServiceApi } from '../api/archiveServiceApi';
import { objectBody } from './objectBody';

export function archiveServiceRoutes(api: ArchiveServiceApi): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const caller = (c: Context<AppEnv>) => { const service = requireService(c); return { identity: service.identity, token: service.token }; };
  const id = (c: Context<AppEnv>) => parseParams(c, z.object({ id: ResourceIdSchema })).id;
  r.post('/v3/objects/tasks/:taskId/archive-plans', async (c) => c.json(await api.create(caller(c), parseParams(c, z.object({ taskId: TaskIdSchema })).taskId, await objectBody(c, CreateArchivePlanSchema)), 201));
  r.get('/v3/objects/archive-plans/:id', async (c) => c.json(await api.get(caller(c), id(c))));
  r.get('/v3/objects/archive-plans/:id/entries', async (c) => c.json(await api.entries(caller(c), id(c), parseQuery(c, ArchivePlanEntriesQuerySchema))));
  r.post('/v3/objects/archive-plans/:id/pages', async (c) => c.json(await api.append(caller(c), id(c), await objectBody(c, ArchivePlanPageSchema, OBJECT_STORAGE_LIMITS.pageBytes))));
  r.post('/v3/objects/archive-plans/:id/seal', async (c) => c.json(await api.seal(caller(c), id(c), await objectBody(c, SealArchivePlanSchema))));
  r.post('/v3/objects/archive-plans/:id/abort', async (c) => c.json(await api.abort(caller(c), id(c), await objectBody(c, SealArchivePlanSchema))));
  return r;
}
