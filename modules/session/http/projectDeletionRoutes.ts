import { ProjectDeletionContextSchema, ResourceIdSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseBody } from '@crewstation/http';
import { Hono } from 'hono';
import type { SessionModuleApi } from '../api/moduleApi';

export function sessionDeletionRoutes(close: NonNullable<SessionModuleApi['closeProjectDeletionTransport']>): Hono<AppEnv> {
  return new Hono<AppEnv>().post('/internal/project-deletion/transports/:consumerId', async (c) => {
    const context = await parseBody(c, ProjectDeletionContextSchema);
    return c.json({ exited: await close(context, ResourceIdSchema.parse(c.req.param('consumerId'))) });
  });
}
