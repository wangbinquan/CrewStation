import { BUSINESS_AGENT_CAPABILITIES } from '../domain/executionAgent';
import { LaunchSpecSchema } from '@crewstation/contracts';
import type { BusinessSubtaskV3Dto, RunnerBusinessReceipt, RunnerCommand, TaskId } from '@crewstation/contracts';
import { newResourceId, PlatformError, quotaExceeded } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import { executionCommandFixture } from './executionCommandFixture';
import type { ComputeCatalog, CreateSubtaskExecutionInput, EnvironmentView } from '../ports/runtime';

export async function executionAgentFixture(db: Database, materials?: { prompt?: string; schema?: string; missing?: boolean }) {
  const contractId = newResourceId();
  const profileId = newResourceId(), computeId = newResourceId(), image = `registry.test/agent@sha256:${'1'.repeat(64)}`;
  const behavior = { businessSupported: true, revision: 1, providerKey: 'provider-secret-one', resolveCount: 0, quota: false, createLost: false, startLost: false, starts: 0, createGate: undefined as Promise<void> | undefined };
  const compute: ComputeCatalog = {
    resolve: async () => { behavior.resolveCount++; return { id: computeId, name: 'compute', revision: behavior.revision, image, protocol: 'opencode', businessExecution: behavior.businessSupported ? { protocolVersion: 3, capabilities: BUSINESS_AGENT_CAPABILITIES } : undefined }; },
    launchMaterial: async (ref) => ({ id: ref.profileId, name: 'compute', revision: ref.revision, image, protocol: 'opencode', launch: LaunchSpecSchema.parse({ protocol: 'opencode', binaryPath: '/usr/bin/opencode' }),
      beforeStart: { profile: ref.profileId, revision: ref.revision, contentHash: 'fixed', vars: {}, secrets: { PROVIDER_KEY: behavior.providerKey }, steps: [], configFile: { kind: 'none' }, captureOutput: false } }),
  };
  const f = await executionCommandFixture(db, { compute, ...(materials ? { releaseMaterials: materials.missing ? {} : { 'prompt.md': materials.prompt ?? '', 'schema.json': materials.schema ?? '{}' }, outputContracts: [{ id: contractId, name: 'result', required: ['result.json'], schema: 'schema.json' }] } : {}), agentProfiles: [{ id: profileId, name: 'review', compute: { kind: 'default' }, ...(materials ? { systemPromptFile: 'prompt.md' } : {}), businessConfig: { allowSystemPromptAppend: true, allowSkills: false, allowedEnvNames: ['APP_VALUE'], mcpConnections: [] } }] });
  f.environments.get(f.task.id)!.businessWorkspace = { volumeUid: 'workspace-volume-one', phase: 'ready' };
  const creates: CreateSubtaskExecutionInput[] = [], starts: Array<{ taskId: TaskId; command: RunnerCommand }> = [], receipts = new Map<string, RunnerBusinessReceipt>();
  f.environmentPort.createNativeExecution = async (input) => {
    creates.push(input); await behavior.createGate;
    const previous = f.environments.get(input.id); if (previous) return previous;
    if (behavior.quota) throw quotaExceeded('full');
    const env: EnvironmentView = { id: input.id, projectId: f.projectId, state: 'creating', connected: false, profile: f.taskProfileId, traceId: f.task.traceId, podName: `agent-${input.id}`, native: { state: 'starting' } };
    f.environments.set(input.id, env);
    if (behavior.createLost) throw new Error('admission response lost'); return env;
  };
  f.environmentPort.releaseEnvironment = async (id) => {
    const env = f.environments.get(id)!; env.state = 'releasing'; env.connected = false; env.native = { state: 'cleaning' }; return env;
  };
  const oldSend = f.runner.sendCommand;
  f.runner.sendCommand = async (taskId, command) => {
    if (taskId === f.task.id) return oldSend(taskId, command);
    starts.push({ taskId, command });
    if (command.type === 'businessExecutionInfo') return { incarnation: f.behavior.incarnation, limits: { outputBytes: 1024, spoolBytes: 2048, eventBytes: 1024 } };
    if (command.type === 'getBusinessExecution') {
      const receipt = receipts.get(command.executionId); if (!receipt) throw new PlatformError('not_found', 'missing', { code: 'execution_not_found' }); return receipt;
    }
    if (command.type === 'startBusinessAgent') {
      behavior.starts++;
      const receipt: RunnerBusinessReceipt = { executionId: command.executionId, attempt: command.attempt, payloadDigest: command.payloadDigest, incarnation: command.incarnation, phase: 'running', lastSequence: 1, acknowledgedSequence: 0, outputBytes: 0, result: null };
      receipts.set(receipt.executionId, receipt); if (behavior.startLost) throw new Error('start response lost'); return receipt;
    }
    throw new Error(`unexpected Agent command ${command.type}`);
  };
  const input = { kind: 'agent', requestKey: 'agent-one', name: 'review', prompt: 'private prompt', agentProfileId: profileId, fence: f.fence };
  const get = async (id: string) => await (await f.request(`${f.path}/${id}`)).json() as BusinessSubtaskV3Dto;
  const ready = () => { const env = f.environments.get(creates[0]!.id)!; env.state = 'running'; env.connected = true; env.native = { state: 'running' }; return env; };
  return { ...f, contractId, compute, agentBehavior: behavior, creates, starts, receipts, input, get, ready, profileId, computeId };
}
