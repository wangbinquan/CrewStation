import { describe, expect, test } from 'bun:test';
import { DevelopmentStartIntentSchema, ServiceIdSchema, TraceIdSchema } from '@crewstation/contracts';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { DevelopmentCleanupSelectionSchema } from '../../domain/development/cleanup';
import { drizzleAgentStarts } from '../../adapters/persistence/drizzleAgentStarts';
import { workspaceActor } from '../workspaceFixture';
import { developmentModuleFixture } from './moduleFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('development internal owner admission (actual factory and PG; controlled price and Session ports)', () => {
  test('ordinary usage and cleanup mutations require original lifetimes; identity reads remain available after closure without issuing commands', async () => {
    const f = await developmentModuleFixture(); let prices = 0, commands = 0;
    f.dependencies.developmentUsagePricing = { accept: async (input) => { prices++; return { ...input, acceptedAt: '2026-10-03T14:00:00.000Z', priceBookRevision: 1 }; } };
    f.dependencies.developmentCleanupSession = { registerDevelopmentUsage: async () => { commands++; throw new Error('should not issue a Session command'); },
      requestDevelopmentUsageDrain: async () => { commands++; throw new Error('should not issue a Session command'); },
      sendCommand: async () => { commands++; throw new Error('should not issue a Session command'); }, getDevelopmentUsage: async () => undefined };
    const module = f.create();
    try {
      const agent = await module.api.startAgent(workspaceActor, f.workspace, { prompt: 'ordinary-private-owner-prompt' });
      await Promise.all(module.workers.map((worker) => worker.stop()));
      const id = agent.execution!.taskId, start = (await drizzleAgentStarts(f.database.db).get(agent.agentId))!;
      const prepared = await module.api.developmentUsage!.prepare({ intent: DevelopmentStartIntentSchema.parse({ version: 1,
        identity: { sourceKind: 'development-agent', projectId: f.project, taskId: f.workspace, agentId: agent.agentId, executionId: id, executionGeneration: 1 },
        profileId: start.profile.profileId, profileRevision: start.profile.revision, launch: { protocol: 'claude-code', binaryPath: '/usr/local/bin/claude' },
        permission: 'full', mode: 'interactive', initialPrompt: start.request.prompt, cwd: null, resumeSessionId: null, systemPrompt: null, mcp: [], nativeUsageLineageKey: 'original-fixture-lineage' }),
      context: { serviceId: ServiceIdSchema.parse(f.workspaceEnvironment.serviceId), traceId: TraceIdSchema.parse(f.workspaceEnvironment.traceId), branch: 'main' } });
      expect(prices).toBe(1);
      const child = f.environments.get(id)!; child.native!.podUid = crypto.randomUUID();
      const info = { version: 1 as const, runtimeTaskId: id, podUid: child.native!.podUid, journalId: crypto.randomUUID(), incarnation: crypto.randomUUID(), receipt: null };
      await module.api.developmentUsage!.observeSupported(id);
      const bound = await module.api.developmentUsage!.bind(id, info);
      expect(bound.binding?.podUid).toBe(info.podUid);
      expect((await f.work.history(f.project)).filter((row) => row.kind === 'usage')).toHaveLength(3);
      expect((await f.work.history(f.project)).every((row) => row.exited)).toBe(true);
      const confirmed = await module.api.deletionOwner!.inspect(f.target); expect(confirmed.complete).toBe(true);
      expect((await module.api.deletionOwner!.run(f.context(confirmed))).kind).toBe('done');
      for (const mutation of [() => module.api.developmentUsage!.prepare({ intent: prepared.intent, context: prepared.context }),
        () => module.api.developmentUsage!.bind(id, info), () => module.api.developmentUsage!.observeSupported(id),
        () => module.api.developmentUsage!.unsupported(id), () => module.api.developmentUsage!.close(id, 'cancelled')])
        await expect(mutation()).rejects.toThrow('封闭');
      const original = await module.api.developmentUsage!.get(id); expect(original).toEqual(bound);
      expect((await module.api.developmentUsage!.resolve(bound.binding!.key))?.registration).toEqual(bound.binding!);
      await expect(module.api.developmentCleanup!.advance(DevelopmentCleanupSelectionSchema.parse({ version: 1, consumerId: newResourceId(), renderStart: 1,
        selectionHash: jsonHash('original-controlled-selection'), identity: bound.binding!.identity, podUid: info.podUid,
        profileId: start.profile.profileId, profileRevision: start.profile.revision }))).rejects.toThrow('封闭');
      expect(prices).toBe(1); expect(commands).toBe(0);
      expect(JSON.stringify(await f.work.history(f.project))).not.toContain('ordinary-private-owner-prompt');
    } finally { await Promise.all(module.workers.map((worker) => worker.stop())); await f.drop(); }
  });
});
