import {prepareAgentFreshRetry,prepareAgentResume} from '../execution/agentResume';
import type {BusinessSubtaskV3Dto,ServiceId} from '@crewstation/contracts';
import type {ExecutionSubtask} from '../../domain/executionSubtask';
import { expect, test } from 'bun:test';
import { TaskIdSchema, ProjectIdSchema, AgentProfileSchema, BusinessNativeConfigSchema, LaunchSpecSchema, StartAgentCommandSchema } from '@crewstation/contracts';
import type { BusinessExecutionDeps } from '../execution/dependencies';
import type { ComputeLaunch } from '../../ports/runtime';
import { BUSINESS_AGENT_CAPABILITIES } from '../../domain/executionAgent';
import type { ExecutionAgentPlan } from '../../domain/executionAgent';
import { pinOpencodeModels, renderPinnedOpencodeModels } from './opencodeModels';
import { agentCommand, agentPayloadDigest } from '../execution/agentMaterial';
import { validateBusinessMaterial } from '../../domain/businessMaterials';

function fixture() {
  const rootId = Bun.randomUUIDv7(), childId = Bun.randomUUIDv7(), secret = new Map<string, string>();
  const image = `registry.example/runner@sha256:${'a'.repeat(64)}`;
  const compute = (id: string, revision = 1) => ({ id, name: id, image, revision, protocol: 'opencode' as const, businessExecution: { protocolVersion: 3 as const, capabilities: { ...BUSINESS_AGENT_CAPABILITIES } } });
  const root = compute(rootId), child = compute(childId);
  const launch = (id: string, revision: number, token: string): ComputeLaunch => ({ ...compute(id, revision), launch: LaunchSpecSchema.parse({ protocol: 'opencode', binaryPath: '/usr/bin/opencode', model: `same/${id === rootId ? 'root' : 'child'}`, opencodeProvider: { id: 'same', npm: '@ai-sdk/openai-compatible', models: { [id === rootId ? 'root' : 'child']: { name: id } }, options: { baseURL: `https://${id === rootId ? 'root' : 'child'}.example/v1` }, credentials: { apiKey: 'MODEL_KEY' } } }), beforeStart: { profile: id, revision, contentHash: 'fixed', vars: {}, secrets: { MODEL_KEY: token }, steps: [], configFile: { kind: 'none' }, captureOutput: false } });
  const state = { resolves: 0, pins: 0, revision: 1, token: 'initial-child-secret', revoked: false, changeImage: false, changeBinary: false, missingMaterial: false, unsupported: false, wrongProtocol: false, unauthorized: false };
  secret.set('root-stamp', 'initial-root-secret');
  const deps = { compute: {
    resolve: async () => { state.resolves++; if (state.unauthorized) throw new Error('project-profile-denied'); return { ...child, revision: state.revision, ...(state.wrongProtocol ? { protocol: 'claude-code' as const } : {}), ...(state.changeImage ? { image: 'other-image' } : {}), ...(state.unsupported ? { businessExecution: undefined } : {}) }; },
    pinLaunchVersion: async () => { const stamp = `child-stamp-${++state.pins}`; secret.set(stamp, state.token); return stamp; },
    launchMaterial: async () => { throw new Error('must use retained version'); },
    launchMaterialAt: async (ref: { profileId: string; revision: number }, stamp: string) => {
      if (state.revoked || !secret.has(stamp)) throw new Error('secret_version_unavailable');
      const value = launch(ref.profileId, ref.revision, secret.get(stamp)!);
      if (state.missingMaterial) delete value.launch.opencodeProvider;
      if (state.changeBinary) value.launch.binaryPath = '/different/opencode';
      return value;
    },
  } } as unknown as BusinessExecutionDeps;
  const childProfile = AgentProfileSchema.parse({ id: Bun.randomUUIDv7(), name: 'child', compute: { kind: 'profile', profileId: childId } });
  const native = BusinessNativeConfigSchema.parse({ version: 1, protocol: 'opencode', agent: { name: 'root', body: '' }, subagents: [{ name: 'child', body: '', agentProfileId: childProfile.id }, { name: 'second', body: '', agentProfileId: childProfile.id }, { name: 'inherit', body: '' }] });
  const input = { projectId: ProjectIdSchema.parse(Bun.randomUUIDv7()), profiles: [childProfile], native, compute: root, launch: launch(rootId, 1, 'initial-root-secret'), stamp: 'root-stamp' };
  return { deps, input, state, childProfile };
}
test('different models and equal provider names keep independent gateways/secrets; duplicate dependencies pin once', async () => {
  const f = fixture(), models = (await pinOpencodeModels(f.deps, f.input))!;
  expect(f.state.resolves).toBe(1); expect(f.state.pins).toBe(1);
  expect(JSON.stringify(models)).not.toContain('initial-child-secret');
  const rendered = await renderPinnedOpencodeModels(f.deps, models);
  expect(Object.keys(rendered.providers)).toHaveLength(2);
  expect(rendered.subagents.child).toBe(rendered.subagents.second);
  expect(rendered.subagents).not.toHaveProperty('inherit');
  expect(rendered.root).not.toBe(rendered.subagents.child);
  const values = Object.values(rendered.providers);
  expect(values.map((entry) => entry.options.baseURL).sort()).toEqual(['https://child.example/v1', 'https://root.example/v1']);
  expect(values.map((entry) => entry.options.apiKey).sort()).toEqual(['initial-child-secret', 'initial-root-secret']);
  expect(Object.values(rendered.identities).map((entry) => entry.model).sort()).toEqual(['same/child', 'same/root']);
  f.state.revision = 8; f.state.token = 'rotated-current';
  expect(await renderPinnedOpencodeModels(f.deps, JSON.parse(JSON.stringify(models)))).toEqual(rendered);
  expect(f.state.resolves).toBe(1); expect(f.state.pins).toBe(1);
  f.state.revoked = true; await expect(renderPinnedOpencodeModels(f.deps, models)).rejects.toThrow('secret_version_unavailable');
});
test('authorization, original release roster, protocol, installed capability and image are checked before dispatch', async () => {
  const absent = fixture(); absent.input.profiles = [];
  await expect(pinOpencodeModels(absent.deps, absent.input)).rejects.toThrow('原发布授权'); expect(absent.state.resolves).toBe(0);
  for (const key of ['unauthorized', 'wrongProtocol', 'unsupported', 'changeImage', 'changeBinary', 'missingMaterial'] as const) {
    const f = fixture(); f.state[key] = true;
    await expect(pinOpencodeModels(f.deps, f.input)).rejects.toThrow();
  }
  const noStamp = fixture(); noStamp.input.stamp = '';
  await expect(pinOpencodeModels(noStamp.deps, noStamp.input)).rejects.toThrow('冻结');
  const inherit = fixture(); inherit.input.native.subagents = [{ name: 'child', body: '', options: {} }];
  expect(await pinOpencodeModels(inherit.deps, inherit.input)).toBeUndefined(); expect(inherit.state.resolves).toBe(0);
});
test('business authorization denies foreign references even if a compute profile exists', () => {
  const f = fixture(), policy = AgentProfileSchema.parse({ ...f.childProfile, businessConfig: { nativeConfig: { agentDefinitions: true } } });
  const material = { systemPrompt: undefined, nativeConfig: f.input.native, env: {}, skills: [], mcp: [], subagents: [] };
  const platform = { protocol: 'opencode' as const, reservedEnv: [], mcp: [] };
  expect(() => validateBusinessMaterial(policy, material, BUSINESS_AGENT_CAPABILITIES, platform, [])).toThrow('未允许');
  expect(() => validateBusinessMaterial(policy, material, { ...BUSINESS_AGENT_CAPABILITIES, nativeModelMappingVersion: undefined }, platform, [f.childProfile])).toThrow('不支持');
});
test('cold dispatch regenerates only pinned secrets and binds compiled models in payload digest', async () => {
  const f = fixture(), models = (await pinOpencodeModels(f.deps, f.input))!;
  const id = TaskIdSchema.parse(Bun.randomUUIDv7());
  const plan = { kind: 'agent-plan', request: { kind: 'agent', requestKey: 'original', name: 'model', prompt: 'test', mode: 'oneshot', agentProfileId: f.childProfile.id }, sessionKey: id, volumeUid: 'original-volume', credentialStamp: 'root-stamp', projectId: f.input.projectId, compute: f.input.compute, opencodeModels: models, material: { env: {}, mcp: [], skills: [], subagents: [], nativeConfig: f.input.native }, secretVersions: [], secretMcp: [], nonce: 'private-nonce', command: StartAgentCommandSchema.parse({ id, type: 'startAgent', agentId: id, processAttemptId: id, compute: f.input.compute.id, profileRevision: 1, launch: f.input.launch.launch, beforeStart: { ...f.input.launch.beforeStart, secrets: {} }, permission: 'full', mode: 'oneshot', businessNativeConfig: f.input.native }) } as ExecutionAgentPlan;
  const command = await agentCommand(f.deps, plan), digest = agentPayloadDigest(command, plan.nonce);
  expect(JSON.stringify(plan)).not.toContain('initial-root-secret');
  f.state.revision = 99; f.state.token = 'new-current';
  const restored = JSON.parse(JSON.stringify(plan)) as ExecutionAgentPlan;
  expect(agentPayloadDigest(await agentCommand(f.deps, restored), restored.nonce)).toBe(digest);
  const changed = structuredClone(command); changed.platformOpencodeModels!.subagents.child = command.platformOpencodeModels!.root;
  expect(agentPayloadDigest(changed, plan.nonce)).not.toBe(digest);
  expect(f.state.resolves).toBe(1);
  const view={taskId:id,executionId:Bun.randomUUIDv7(),agentProfileId:f.childProfile.id,computeProfileId:f.input.compute.id,profileRevision:1,materialDigest:'a'.repeat(64)} as unknown as BusinessSubtaskV3Dto;
  const source={view,runtimeTaskId:id,runtimeReleased:true,sealedPayload:JSON.stringify(restored)} as unknown as ExecutionSubtask;
  const deps={...f.deps,environments:{getEnvironment:async()=>({projectId:f.input.projectId,businessWorkspace:{volumeUid:'original-volume'}})},sessions:{get:async()=>({volumeUid:'original-volume',state:'idle',leaseExecutionId:null,sourceExecutionId:view.executionId,sessionKey:id})},subtasks:{forExecution:async()=>source},cipher:{open:async(value:string)=>value}} as unknown as BusinessExecutionDeps;
  const fresh=await prepareAgentFreshRetry(deps,source,restored,view,TaskIdSchema.parse(Bun.randomUUIDv7()),restored.request);
  const resumed=await prepareAgentResume(deps,Bun.randomUUIDv7() as ServiceId,view,'original-volume',id,{...restored.request,resumeSessionId:'original-session'});
  expect(fresh.plan.opencodeModels).toEqual(models);expect(resumed.plan.opencodeModels).toEqual(models);
  expect((await agentCommand(deps,fresh.plan)).platformOpencodeModels).toEqual(command.platformOpencodeModels);
  expect((await agentCommand(deps,resumed.plan)).platformOpencodeModels).toEqual(command.platformOpencodeModels);
  expect(f.state.resolves).toBe(1);expect(f.state.pins).toBe(1);
});
