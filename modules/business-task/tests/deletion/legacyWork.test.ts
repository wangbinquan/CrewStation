import { describe, expect, test } from 'bun:test';
import type { ServiceActor, SubtaskDto } from '@crewstation/contracts';
import { TraceIdSchema } from '@crewstation/contracts';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { newResourceId } from '@crewstation/kernel';
import { executionHttpFixture } from '../executionHttpFixture';
import { businessWorkFixture } from './workFixture';

const available = await testDatabaseAvailable();
const settings = () => ({ legacyFixedAdmission: true, mcp: [], outputLimitBytes: 262144, consumerName: newResourceId(), secretKeyBase64: Buffer.alloc(32, 27).toString('base64') });
describe.skipIf(!available)('legacy command acceptance retains the entire detached callback (actual PG/module)', () => {
  test('accepted response returns before command completion, but original callbacks persist through result settlement and private finally', async () => {
    const f = await businessWorkFixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    try {
      const business = await executionHttpFixture(f.database.db); f.bind(business.serviceId, business.projectId);
      const mounted = business.make({ deletionWorkSources: f.sources, settings: settings() });
      const caller: ServiceActor = { identity: 'demo/demo', project: 'demo', service: 'demo', slot: 'prod' };
      const task = await mounted.module.api.createTask(caller, { labels: {}, taskProfileId: business.taskProfileId, traceId: TraceIdSchema.parse('0123456789abcdef0123456789abcdef') });
      const env = business.environments.get(task.id)!; env.connected = true; env.state = 'running';
      business.runner.sendCommand = async (_id, command) => {
        if (command.type !== 'exec') throw new Error('unexpected legacy command');
        entered.resolve(); await release.promise; return { execId: command.execId, exitCode: 0, stdout: 'private result', stderr: '', truncated: false };
      };
      const response = await mounted.module.api.submitSubtask(caller, task.id, { kind: 'command', name: 'original', command: ['sh', '-c', 'true'], timeoutSeconds: 30 });
      expect(response.state).toBe('running'); await entered.promise;
      const pending = (await mounted.module.projectWork!.history(business.projectId)).filter((row) => !row.exited);
      expect(pending.length).toBeGreaterThanOrEqual(3); expect(pending.every((row) => row.kind === 'legacy-api')).toBe(true);
      const linked = await f.database.db.execute<{ callback_id: string | null }>(sql`SELECT callback_id FROM business_task.legacy_mutations WHERE service_id=${business.serviceId}`);
      expect(linked.every((row) => row.callback_id !== null)).toBe(true);
      release.resolve(); for (const birth of pending) await f.waitExit(birth.id);
      const settled = await mounted.module.api.getSubtask(caller, task.id, response.id);
      expect(settled.state).toBe('succeeded'); expect(await mounted.module.api.subtaskOutput(caller, task.id, response.id)).toBe('private result');
      for (const birth of await mounted.module.projectWork!.history(business.projectId)) if (!birth.exited) await f.waitExit(birth.id);
      expect((await mounted.module.projectWork!.history(business.projectId)).every((row) => row.exited)).toBe(true);
    } finally { release.resolve(); await f.drop(); }
  });

  test('seal queued behind the detached original command waits until its private result and all original finally records finish', async () => {
    const f = await businessWorkFixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let sealing: Promise<unknown> | undefined;
    try {
      const business = await executionHttpFixture(f.database.db);
      const mounted = business.make({ deletionWorkSources: f.sources, settings: settings() });
      const caller: ServiceActor = { identity: 'demo/demo', project: 'demo', service: 'demo', slot: 'prod' };
      f.bind(business.serviceId, business.projectId);
      const task = await mounted.module.api.createTask(caller, { labels: {}, taskProfileId: business.taskProfileId, traceId: TraceIdSchema.parse('0123456789abcdef0123456789abcdef') }); business.environments.get(task.id)!.connected = true;
      business.runner.sendCommand = async (_id, command) => { if (command.type !== 'exec') throw new Error('unexpected'); entered.resolve(); await release.promise; return { execId: command.execId, exitCode: 0, stdout: '', stderr: '', truncated: false }; };
      const child: SubtaskDto = await mounted.module.api.submitSubtask(caller, task.id, { kind: 'command', name: 'seal', command: ['true'], timeoutSeconds: 30 });
      await entered.promise;
      const sources = { ...f.sources, assertGrant: async () => undefined };
      const ownerModule = business.make({ deletionWorkSources: sources });
      const context = f.context();
      let done = false;
      sealing = ownerModule.module.projectWork!.seal({ ...context, target: { ...context.target, id: business.projectId, serviceId: business.serviceId } }).then((value) => { done = true; return value; });
      await f.waitSeal(business.projectId);
      expect(done).toBe(false);
      release.resolve(); expect(await sealing).toEqual({ pending: [] });
      expect((await f.database.db.execute<{ state: string }>(sql`SELECT state FROM business_task.subtasks WHERE id=${child.id}`))[0]?.state).toBe('succeeded');
      expect((await mounted.module.projectWork!.history(business.projectId)).every((row) => row.exited)).toBe(true);
    } finally { release.resolve(); await sealing?.catch(() => undefined); await f.drop(); }
  });
});
