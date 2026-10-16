import { Hono } from 'hono';
import { z } from 'zod';
import { ResourceIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseParams } from '@crewstation/http';
import { forbidden } from '@crewstation/kernel';
import type { MaterialObjectApi } from '../api/materialObjectApi';
import { objectDownloadResponse } from './objectDownloadResponse';
export function materialObjectRoutes(api: MaterialObjectApi) {
  const router = new Hono<AppEnv>();
  router.get('/internal/material-objects/:objectId', async (c) => {
    const auth = c.req.header('authorization');
    if (!auth?.startsWith('Bearer ') || auth.length > 4103) throw forbidden('缺少材料下载授权');
    const { objectId } = parseParams(c, z.object({ objectId: ResourceIdSchema }));
    return objectDownloadResponse(await api.download(objectId, auth.slice(7), c.req.raw.signal));
  });
  return router;
}
