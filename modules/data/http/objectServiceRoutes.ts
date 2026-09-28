import type { AppEnv } from '@crewstation/http';
import { parseParams, parseQuery, requireService } from '@crewstation/http';
import { BusinessExecutionFenceSchema, CommitObjectUploadSchema, CreateObjectUploadSchema, DeleteStoredObjectSchema, ObjectPageQuerySchema, ObjectReferenceSchema, ResourceIdSchema } from '@crewstation/contracts';
import { isPlatformError, validation } from '@crewstation/kernel';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { ObjectServiceApi } from '../api/objectServiceApi';
import { objectDownloadResponse } from './objectDownloadResponse';
import { objectBody } from './objectBody';

/** Raw content uses a bounded stream; metadata uses an independent small JSON limit. */
export function objectServiceRoutes(api: ObjectServiceApi): Hono<AppEnv> {
  const r = new Hono<AppEnv>(), root = '/v3/objects';
  const caller = (c: Context<AppEnv>) => { const identity = requireService(c); return { identity: identity.identity, ...(identity.token ? { token: identity.token } : {}) }; };
  const id = (c: Context<AppEnv>) => parseParams(c, z.object({ id: ResourceIdSchema })).id;
  r.use(`${root}/*`, async (c, next) => { try { await next(); if (c.res.status === 429) c.header('Retry-After', '5'); } catch (error) { if (isPlatformError(error) && error.kind === 'quota_exceeded') c.header('Retry-After', '5'); throw error; } });
  r.get(`${root}/space`, async (c) => c.json(await api.space(caller(c))));
  r.post(`${root}/uploads`, async (c) => c.json(await api.upload(caller(c), await objectBody(c, CreateObjectUploadSchema)), 201));
  r.get(`${root}/uploads/:id`, async (c) => c.json(await api.uploadStatus(caller(c), id(c))));
  r.post(`${root}/uploads/:id/commit`, async (c) => c.json(await api.commit(caller(c), id(c), await objectBody(c, CommitObjectUploadSchema)), 202));
  r.put(`${root}/uploads/:id/content`, async (c) => {
    const source = caller(c), value = c.req.header('content-length'), length = value === undefined ? NaN : Number(value);
    if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(length) || length < 0) throw validation('上传必须声明有效 Content-Length');
    if (c.req.header('content-encoding') && c.req.header('content-encoding') !== 'identity') throw validation('对象上传不接受 Content-Encoding');
    const header = c.req.header('x-cs-object-fence'); let fence;
    if (header) { try { if (header.length > 512) throw new Error(); fence = BusinessExecutionFenceSchema.parse(JSON.parse(header)); } catch { throw validation('x-cs-object-fence 无效'); } }
    const body = c.req.raw.body ?? new ReadableStream<Uint8Array>({ start: (controller) => controller.close() });
    return c.json(await api.content(source, id(c), { body, length, signal: c.req.raw.signal, ...(fence ? { fence } : {}) }), 202);
  });
  r.get(root, async (c) => c.json(await api.list(caller(c), parseQuery(c, ObjectPageQuerySchema))));
  r.get(`${root}/:id`, async (c) => c.json(await api.get(caller(c), id(c))));
  r.get(`${root}/:id/content`, async (c) => {
    const range = c.req.header('range'), result = await api.download(caller(c), id(c), { signal: c.req.raw.signal, ...(range ? { range } : {}) });
    return objectDownloadResponse(result);
  });
  for (const method of ['put', 'delete'] as const) r[method](`${root}/:id/references`, async (c) => c.json(await api.reference(caller(c), id(c), await objectBody(c, ObjectReferenceSchema), method === 'put' ? 'active' : 'released')));
  r.delete(`${root}/:id`, async (c) => c.json(await api.delete(caller(c), id(c), await objectBody(c, DeleteStoredObjectSchema)), 202));
  return r;
}
