import type { UserId } from '@crewstation/contracts';
import { SaveWorkspaceLayoutRequestSchema, TaskIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { actorFrom, parseBody, parseParams } from '@crewstation/http';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { DevSessionModuleApi } from '../api/moduleApi';

export function workspaceLayoutRoutes(api: Pick<DevSessionModuleApi, 'getWorkspaceLayout' | 'saveWorkspaceLayout'>, isAdmin: (id: UserId) => Promise<boolean>): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const params = z.object({ taskId: TaskIdSchema });
  const actor = async (c: Context<AppEnv>) => { const a = await actorFrom(c, (id) => isAdmin(id as UserId)); return { userId: a.userId as UserId, isAdmin: a.isAdmin }; };
  r.get('/v1/tasks/:taskId/workspace-layout', async (c) => c.json(await api.getWorkspaceLayout(await actor(c), parseParams(c, params).taskId)));
  r.put('/v1/tasks/:taskId/workspace-layout', async (c) => c.json(await api.saveWorkspaceLayout(await actor(c), parseParams(c, params).taskId, await parseBody(c, SaveWorkspaceLayoutRequestSchema))));
  return r;
}
