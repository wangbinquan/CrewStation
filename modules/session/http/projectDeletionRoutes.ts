import { ProjectDeletionContextSchema, ProjectDeletionSessionDataRequestSchema, ProjectDeletionSessionTasksRequestSchema, ResourceIdSchema, RunnerCommandSchema } from '@crewstation/contracts';
import { z } from 'zod';
import type { AppEnv } from '@crewstation/http';
import { parseBody } from '@crewstation/http';
import { Hono } from 'hono';
import type { SessionModuleApi } from '../api/moduleApi';

export function sessionDeletionRoutes(close: NonNullable<SessionModuleApi['closeProjectDeletionTransport']>,
  command?: NonNullable<SessionModuleApi['sendProjectDeletionCommand']>, data?: NonNullable<SessionModuleApi['applyProjectDeletionData']>,
  tasks?: NonNullable<SessionModuleApi['originalProjectDeletionTasks']>): Hono<AppEnv> {
  const routes = new Hono<AppEnv>().post('/internal/project-deletion/transports/:consumerId', async (c) => {
    const context = await parseBody(c, ProjectDeletionContextSchema);
    return c.json({ exited: await close(context, ResourceIdSchema.parse(c.req.param('consumerId'))) });
  });
  if (command) routes.post('/internal/project-deletion/commands/:consumerId', async (c) => {
    const input = await parseBody(c, z.strictObject({ context: ProjectDeletionContextSchema, command: RunnerCommandSchema }));
    return c.json({ payload: await command(input.context, ResourceIdSchema.parse(c.req.param('consumerId')), input.command) });
  });
  if (data) routes.post('/internal/project-deletion/data', async (c) => {
    const input = await parseBody(c, ProjectDeletionSessionDataRequestSchema);
    return c.json({ payload: (await data(input.context, input.taskId, input.operation)) ?? null });
  });
  if (tasks) routes.post('/internal/project-deletion/tasks', async (c) => {
    const input = await parseBody(c, ProjectDeletionSessionTasksRequestSchema);
    return c.json({ payload: await tasks(input.context, input.after) });
  });
  return routes;
}
