import { BUSINESS_AGENT_CAPABILITIES } from '../domain/executionAgent';
import { expect } from 'bun:test';
import { AgentProfileSchema, LaunchSpecSchema } from '@crewstation/contracts';
import type { BusinessControlDto, BusinessTaskV3Dto, RuntimeImageExecutionSnapshot } from '@crewstation/contracts';
import type { Database } from '@crewstation/persistence';
import { newResourceId, precondition, quotaExceeded } from '@crewstation/kernel';
import type { BusinessRuntimeImages } from '../ports/runtimeImages';
import type { ComputeCatalog, Environments } from '../ports/runtime';
import { executionHttpFixture } from './executionHttpFixture';

export async function agentRuntimeImageFixture(db: Database) {
  const parentVersion = newResourceId(), defaultVersion = newResourceId(), explicitVersion = newResourceId(), otherVersion = newResourceId(), computeId = newResourceId();
  const digest = `sha256:${'a'.repeat(64)}`;
  const snapshot = (versionId: string): RuntimeImageExecutionSnapshot => ({ versionId, image: `registry.test/tools@${digest}`, digest, architecture: 'linux/amd64', initializer: { steps: [], env: {}, secrets: [] }, tools: [], initializerDigest: digest, validationId: newResourceId(), selectionSource: 'configuration' });
  const profiles = [
    { id: newResourceId(), name: 'A', runtimeImageVersionId: defaultVersion, allowedRuntimeImageVersionIds: [explicitVersion] },
    { id: newResourceId(), name: 'B', runtimeImageVersionId: otherVersion },
    { id: newResourceId(), name: 'C' },
  ].map((profile) => AgentProfileSchema.parse({ ...profile, compute: { kind: 'default' } }));
  const reservations: Array<Parameters<NonNullable<BusinessRuntimeImages['reserveAgent']>>> = [], order: string[] = [];
  const inputs: Array<Parameters<Environments['createNativeExecution']>[0]> = [], state = { quota: false };
  const port: BusinessRuntimeImages = {
    reserveTask: async () => snapshot(parentVersion), confirmTask: async () => {},
    reserveAgent: async (...args) => {
      reservations.push(args); const [, , selection, , requested] = args;
      if (requested && requested !== selection.runtimeImageVersionId && !selection.allowedRuntimeImageVersionIds?.includes(requested)) throw precondition('镜像不在此 Agent 允许集合');
      return { ...snapshot(requested ?? selection.runtimeImageVersionId!), selectionSource: requested ? 'request' : 'configuration' };
    },
    confirmAgent: async (_image, id) => { order.push(`confirm:${id}`); },
  };
  const resolved = { businessExecution: { protocolVersion: 3 as const, capabilities: BUSINESS_AGENT_CAPABILITIES }, id: computeId, name: 'compute', revision: 3, protocol: 'opencode' as const, image: `registry.test/platform@${digest}` };
  const compute: ComputeCatalog = { resolve: async () => resolved, launchMaterial: async () => ({ ...resolved, launch: LaunchSpecSchema.parse({ protocol: 'opencode', binaryPath: '/usr/local/bin/opencode', model: 'opencode/one' }), beforeStart: { profile: computeId, revision: 3, contentHash: 'h', steps: [], vars: {}, secrets: {}, configFile: { kind: 'none' }, captureOutput: false } }) };
  const f = await executionHttpFixture(db, { port, selection: { runtimeImageVersionId: parentVersion } }, { agentProfiles: profiles, compute });
  const instanceId = newResourceId(), control = '/v3/business-execution/control';
  const lease = await (await f.request(`${control}/claim`, { instanceId })).json() as BusinessControlDto;
  const fence = { instanceId, epoch: lease.epoch, leaseId: lease.leaseId! };
  expect((await f.request(`${control}/activate`, { instanceId, expectedEpoch: fence.epoch, leaseId: fence.leaseId, preparationDigest: 'a'.repeat(64) })).status).toBe(200);
  const task = await (await f.request('/v3/business-tasks', { requestKey: 'parent', taskContractVersion: 'v1', fence })).json() as BusinessTaskV3Dto;
  const parent = f.environments.get(task.id)!; parent.state = 'running'; parent.connected = true; parent.businessWorkspace = { volumeUid: 'runtime-image-workspace', phase: 'ready' };
  f.runner.sendCommand = async () => ({ incarnation: newResourceId(), limits: { outputBytes: 1024, spoolBytes: 2048, eventBytes: 1024 } });
  f.environmentPort.createNativeExecution = async (input) => {
    inputs.push(input); order.push(`create:${input.id}`);
    const old = f.environments.get(input.id); if (old) return old;
    if (state.quota) throw quotaExceeded('full');
    const env = { ...parent, id: input.id, connected: false, state: 'creating' as const }; f.environments.set(input.id, env); return env;
  };
  return { ...f, task, profiles, computeId, parentVersion, defaultVersion, explicitVersion, otherVersion, reservations, inputs, order, state, port,
    path: `/v3/business-tasks/${task.id}/subtasks`, input: { kind: 'agent', name: 'A', agentProfileId: profiles[0]!.id, requestKey: 'agent', prompt: 'hello', fence } };
}
