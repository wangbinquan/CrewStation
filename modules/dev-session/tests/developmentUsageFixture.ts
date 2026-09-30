import type { DevelopmentUsageInfo, TaskId } from '@crewstation/contracts';
import { DevelopmentStartIntentSchema, TraceIdSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import type { AgentStart } from '../ports/agentStarts';
import type { DevelopmentUsagePreparation as Preparation, DevelopmentUsagePricing } from '../ports/developmentUsage';
import type { EnvironmentView } from '../ports/runtime';
import { drizzleAgentStarts } from '../adapters/persistence/drizzleAgentStarts';
import { developmentUsageOwnerStore } from '../adapters/persistence/developmentUsage';
import { developmentUsageOwner } from '../application/developmentUsage';
import { workspaceActor, workspaceProject, workspaceService, workspaceTask } from './workspaceFixture';

export async function developmentUsageFixture(db: Database) {
  const starts = drizzleAgentStarts(db), store = developmentUsageOwnerStore(db);
  const profileId = newResourceId();
  const start: AgentStart = { agentId: newResourceId(), taskId: workspaceTask, createdBy: workspaceActor.userId, compute: profileId, profile: { profileId, revision: 2 }, permission: 'full',
    request: { prompt: 'owner-private-prompt', cwd: '/work', resumeSessionId: 'original-native-root' }, execution: { taskId: newResourceId() as TaskId, runnerId: crypto.randomUUID(), image: 'registry.test/runner@sha256:' + 'a'.repeat(64) }, state: 'pending', cursor: 0, finalized: false, createdAt: '2026-09-30T00:10:00.000Z' };
  await starts.insert(start);
  const traceId = TraceIdSchema.parse('a'.repeat(32)), podUid = crypto.randomUUID();
  const workspace: EnvironmentView = { id: workspaceTask, projectId: workspaceProject, serviceId: workspaceService, state: 'running', podName: 'original-workspace', connected: true, branch: 'main', traceId, createdAt: start.createdAt, lastActivityAt: start.createdAt };
  const child: EnvironmentView = { ...workspace, id: start.execution.taskId, podName: 'actual-agent', native: { purpose: 'agent', parentTaskId: workspaceTask, agentId: start.agentId, runnerId: start.execution.runnerId, podUid, state: 'running', profile: { name: 'Compute name', cpu: '1', memory: '2Gi', storage: '10Gi' } } };
  const envs = new Map<TaskId, EnvironmentView>([[workspace.id, workspace], [child.id, child]]);
  const controls = { priceCalls: 0, priceRevision: 3, priceFailure: undefined as unknown, badPrice: undefined as Record<string, unknown> | undefined };
  const priceReceipts = new Map<string, Awaited<ReturnType<DevelopmentUsagePricing['accept']>>>();
  const pricing: DevelopmentUsagePricing = { accept: async (input) => {
    controls.priceCalls++;
    if (controls.priceFailure) throw controls.priceFailure;
    if (!priceReceipts.has(input.identity.executionId)) priceReceipts.set(input.identity.executionId, { ...structuredClone(input), acceptedAt: '2026-09-30T00:10:01.000Z', priceBookRevision: controls.priceRevision });
    return { ...structuredClone(priceReceipts.get(input.identity.executionId)!), ...controls.badPrice };
  } };
  const environmentPort = { getEnvironment: async (id: TaskId) => structuredClone(envs.get(id)) };
  const owner = developmentUsageOwner(store, starts, environmentPort, pricing);
  const preparation: Preparation = { intent: DevelopmentStartIntentSchema.parse({ version: 1, identity: { sourceKind: 'development-agent', projectId: workspaceProject, taskId: workspaceTask, agentId: start.agentId, executionId: start.execution.taskId, executionGeneration: 1 },
    profileId: start.profile.profileId, profileRevision: 2, launch: { protocol: 'opencode', binaryPath: '/usr/local/bin/opencode', model: 'provider/configured-model' }, permission: 'full', mode: 'interactive', initialPrompt: start.request.prompt, cwd: '/work', resumeSessionId: 'original-native-root', systemPrompt: null, mcp: [{ name: 'platform', url: 'http://platform.example.test/' }], nativeUsageLineageKey: 'fixture-actual-workspace-native-store' }), context: { serviceId: workspaceService, traceId, branch: 'main' } };
  const info: DevelopmentUsageInfo = { version: 1, runtimeTaskId: child.id, podUid, journalId: crypto.randomUUID(), incarnation: crypto.randomUUID(), receipt: null };
  return { starts, store, start, owner, preparation, info, envs, workspace, child, controls, pricing, environmentPort };
}
