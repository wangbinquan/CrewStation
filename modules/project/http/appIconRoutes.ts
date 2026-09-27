import { APP_ICON_MAX_BYTES, ProjectIdSchema, SetAppPresentationRequestSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseParams } from '@crewstation/http';
import { validation } from '@crewstation/kernel';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { ProjectModuleApi } from '../api/moduleApi';
import { actorFrom } from './actor';

export function appIconRoutes(api: ProjectModuleApi): Hono<AppEnv> {
  const routes = new Hono<AppEnv>(), params = z.object({ projectId: ProjectIdSchema });
  routes.get('/v1/apps/:projectId/icon', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    const image = await api.getAppIcon(await actorFrom(c, api), parseParams(c, params).projectId);
    return c.body(new Uint8Array(Buffer.from(image.content, 'base64')), 200, { 'Content-Type': image.mime, 'X-Content-Type-Options': 'nosniff' });
  });
  routes.put('/v1/projects/:projectId/app-icon', bodyLimit({ maxSize: APP_ICON_MAX_BYTES + 8192, onError: () => { throw validation('图标文件不能超过 2 MiB'); } }), async (c) => {
    const actor = await actorFrom(c, api), projectId = parseParams(c, params).projectId;
    await api.authorize(actor, projectId, 'manage-members');
    let fields: FormData;
    try { fields = await c.req.raw.formData(); } catch { throw validation('请上传图标文件与展示资料'); }
    const file = fields.get('file'), raw = fields.get('presentation');
    if (!(file instanceof File) || file.size > APP_ICON_MAX_BYTES || typeof raw !== 'string' || [...fields.keys()].some((key) => key !== 'file' && key !== 'presentation') || fields.getAll('file').length !== 1 || fields.getAll('presentation').length !== 1) throw validation('图标上传格式无效');
    let input;
    try { input = SetAppPresentationRequestSchema.parse(JSON.parse(raw)); } catch { throw validation('图标展示资料无效'); }
    return c.json(await api.uploadAppIcon(actor, projectId, input, new Uint8Array(await file.arrayBuffer())));
  });
  return routes;
}
