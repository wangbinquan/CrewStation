import { z } from 'zod';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '@crewstation/http';
import { parseParams, parseQuery } from '@crewstation/http';
import { ArchiveHelperFailureSchema, ArchiveHelperPageSchema, ArchiveHelperResultSchema, ArchiveHelperUploadSchema, ResourceIdSchema } from '@crewstation/contracts';
import { forbidden, validation } from '@crewstation/kernel';
import type { ArchiveHelperApi } from '../api/archiveHelperApi';
import { objectBody } from './objectBody';

/** Dedicated internal transfer listener; grants cannot list/read arbitrary objects or mint other grants. */
export function archiveHelperRoutes(api: ArchiveHelperApi) {
  const router = new Hono<AppEnv>(), root = '/internal/archive-helpers/:id';
  const caller = (c: Context<AppEnv>) => {
    const { id } = parseParams(c, z.object({ id: ResourceIdSchema }));
    const authorization = c.req.header('authorization');
    if (!authorization?.startsWith('Bearer ') || authorization.length > 263) throw forbidden('缺少归档助手凭证');
    const podUid = ResourceIdSchema.safeParse(c.req.header('x-cs-archive-pod-uid'));
    if (!podUid.success) throw forbidden('缺少归档助手 Pod 身份');
    return { id, token: authorization.slice(7), podUid: podUid.data };
  };
  const uploadId = (c: Context<AppEnv>) => parseParams(c, z.object({ uploadId: ResourceIdSchema })).uploadId;
  router.get(`${root}/entries`, async (c) => { const { offset, limit } = parseQuery(c, ArchiveHelperPageSchema); return c.json(await api.entries(caller(c), offset, limit)); });
  router.post(`${root}/uploads`, async (c) => c.json(await api.upload(caller(c), await objectBody(c, ArchiveHelperUploadSchema)), 201));
  router.get(`${root}/uploads/:uploadId`, async (c) => c.json(await api.status(caller(c), uploadId(c))));
  router.post(`${root}/uploads/:uploadId/commit`, async (c) => c.json(await api.commit(caller(c), uploadId(c)), 202));
  router.put(`${root}/uploads/:uploadId/content`, async (c) => {
    const value = c.req.header('content-length'), length = value === undefined ? NaN : Number(value);
    if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(length) || length < 0) throw validation('归档文件需要有效 Content-Length');
    if (c.req.header('content-encoding') && c.req.header('content-encoding') !== 'identity') throw validation('归档上传不接受 Content-Encoding');
    const body = c.req.raw.body ?? new ReadableStream<Uint8Array>({ start: (controller) => controller.close() });
    return c.json(await api.content(caller(c), uploadId(c), { body, length, signal: c.req.raw.signal }), 202);
  });
  router.post(`${root}/results`, async (c) => { await api.result(caller(c), await objectBody(c, ArchiveHelperResultSchema)); return c.body(null, 204); });
  router.post(`${root}/complete`, async (c) => { await api.complete(caller(c)); return c.body(null, 204); });
  router.post(`${root}/failure`, async (c) => { await api.fail(caller(c), await objectBody(c, ArchiveHelperFailureSchema)); return c.body(null, 204); });
  return router;
}
