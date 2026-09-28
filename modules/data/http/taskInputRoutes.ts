import { Hono } from 'hono';
import { z } from 'zod';
import { ResourceIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseParams } from '@crewstation/http';
import { forbidden } from '@crewstation/kernel';
import type { Context } from 'hono';
import type { TaskInputApi } from '../api/taskInputApi';
import { objectDownloadResponse } from './objectDownloadResponse';

export function taskInputRoutes(api: TaskInputApi) {
  const router = new Hono<AppEnv>(), root = '/internal/task-inputs/:id';
  const caller = (c: Context<AppEnv>) => {
    const { id } = parseParams(c, z.object({ id: ResourceIdSchema }));
    const auth = c.req.header('authorization'), podUid = c.req.header('x-cs-input-pod-uid');
    if (!auth?.startsWith('Bearer ') || auth.length > 263 || !podUid || !z.uuid().safeParse(podUid).success) throw forbidden('缺少任务输入授权');
    return { id, token: auth.slice(7), podUid };
  };
  router.get(root, async (c) => c.json(await api.manifest(caller(c))));
  router.get(`${root}/objects/:objectId`, async (c) => objectDownloadResponse(await api.download(caller(c), parseParams(c, z.object({ objectId: ResourceIdSchema })).objectId, c.req.raw.signal)));
  router.post(`${root}/complete`, async (c) => { await api.complete(caller(c)); return c.body(null, 204); });
  return router;
}
