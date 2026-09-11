import { ConfigEnvSchema, ConfigNameSchema, ProjectIdSchema, SetConfigItemRequestSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseBody, parseParams } from '@crewstation/http';
import { validation } from '@crewstation/kernel';
import { Hono } from 'hono';
import { z } from 'zod';
import type { ConfigModuleApi } from '../api/moduleApi';
import type { ActorResolver } from './actor';
import { actorFrom } from './actor';

const envParams = z.object({ projectId: ProjectIdSchema, env: ConfigEnvSchema });
const itemParams = envParams.extend({ name: ConfigNameSchema });

/** 配置与 Secret：读写都按项目角色表授权；renderEnv 不在此暴露。 */
export function configRoutes(api: ConfigModuleApi, actors: ActorResolver): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/v1/projects/:projectId/config/:env', async (c) => {
    const { projectId, env } = parseParams(c, envParams);
    return c.json({ items: await api.listItems(await actorFrom(c, actors), projectId, env) });
  });
  r.put('/v1/projects/:projectId/config/:env', async (c) => {
    const { projectId, env } = parseParams(c, envParams);
    const body = await parseBody(c, SetConfigItemRequestSchema);
    if (body.env !== env) throw validation(`请求体 env=${body.env} 与路径 env=${env} 不一致`);
    return c.json(await api.setItem(await actorFrom(c, actors), projectId, body));
  });
  r.delete('/v1/projects/:projectId/config/:env/:name', async (c) => {
    const { projectId, env, name } = parseParams(c, itemParams);
    await api.deleteItem(await actorFrom(c, actors), projectId, env, name);
    return c.body(null, 204);
  });
  r.get('/v1/projects/:projectId/config/:env/versions', async (c) => {
    const { projectId, env } = parseParams(c, envParams);
    return c.json({ items: await api.listVersions(await actorFrom(c, actors), projectId, env) });
  });
  return r;
}
