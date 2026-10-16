import type { ProjectId, AgentProfile, BusinessNativeConfig, PlatformOpencodeModels } from '@crewstation/contracts';
import { PlatformOpencodeModelsSchema } from '@crewstation/contracts';
import { precondition, validation } from '@crewstation/kernel';
import type { ExecutionAgentPlan, PinnedOpencodeModel, ResolvedBusinessCompute } from '../../domain/executionAgent';
import type { ComputeLaunch } from '../../ports/runtime';
import type { BusinessExecutionDeps } from '../execution/dependencies';
import { requireBusinessAgent } from '../execution/capabilities';

const unavailable = () => precondition('档位缺少可冻结的 OpenCode 模型材料或原生映射能力，请管理员补齐结构化 provider 并测试', { code: 'unsupported_capability', capability: 'nativeModelMappingVersion' });
function pinned(compute: ResolvedBusinessCompute, launch: ComputeLaunch, stamp: string | undefined): PinnedOpencodeModel {
  const provider = launch.launch.opencodeProvider, model = launch.launch.model;
  if (compute.protocol !== 'opencode' || requireBusinessAgent(compute).nativeModelMappingVersion !== 1 || !stamp || !provider || !model?.startsWith(`${provider.id}/`) || !Object.hasOwn(provider.models, model.slice(provider.id.length + 1))) throw unavailable();
  if (launch.id !== compute.id || launch.revision !== compute.revision || launch.protocol !== compute.protocol || launch.image !== compute.image) throw unavailable();
  return { compute, credentialStamp: stamp, model, binaryPath: launch.launch.binaryPath };
}
/** Resolve only the parent's authorized profile roster; all later commands use these retained revisions. */
export async function pinOpencodeModels(deps: BusinessExecutionDeps, input: { projectId: ProjectId; profiles: readonly AgentProfile[]; native?: BusinessNativeConfig; compute: ResolvedBusinessCompute; launch: ComputeLaunch; stamp?: string }): Promise<ExecutionAgentPlan['opencodeModels']> {
  const selected = input.native?.subagents.filter((agent) => agent.agentProfileId);
  if (!selected?.length) return;
  if (!deps.compute.pinLaunchVersion || !deps.compute.launchMaterialAt || input.native?.protocol !== 'opencode') throw unavailable();
  const root = pinned(input.compute, input.launch, input.stamp), subagents: Record<string, PinnedOpencodeModel> = {};
  const byCompute = new Map([[`${root.compute.id}@${root.compute.revision}`, root]]);
  const byProfile = new Map<string, PinnedOpencodeModel>();
  for (const agent of selected) {
    const profile = input.profiles.find((entry) => entry.id === agent.agentProfileId);
    if (!profile) throw validation('子 Agent 档位不属于父任务的原发布授权', { code: 'invalid_configuration' });
    let value = byProfile.get(profile.id);
    if (!value) {
      const compute = await deps.compute.resolve(profile.compute, 'subtask', input.projectId);
      value = byCompute.get(`${compute.id}@${compute.revision}`);
      if (!value) {
        const ref = { profileId: compute.id, revision: compute.revision }, stamp = await deps.compute.pinLaunchVersion(ref);
        value = pinned(compute, await deps.compute.launchMaterialAt(ref, stamp), stamp);
        if (compute.image !== root.compute.image || value.binaryPath !== root.binaryPath) throw precondition('内部子代理必须与根 Agent 使用同一已验证镜像和 OpenCode 二进制', { code: 'unsupported_capability', capability: 'nativeModelMappingVersion' });
        byCompute.set(`${compute.id}@${compute.revision}`, value);
      }
      byProfile.set(profile.id, value);
    }
    subagents[agent.name] = value;
  }
  return { root, subagents };
}

/** Secrets exist only in the dispatch result, never in the persistent plan. */
export async function renderPinnedOpencodeModels(deps: BusinessExecutionDeps, models: NonNullable<ExecutionAgentPlan['opencodeModels']>): Promise<PlatformOpencodeModels> {
  if (!deps.compute.launchMaterialAt) throw unavailable();
  const providers: PlatformOpencodeModels['providers'] = {}, identities: PlatformOpencodeModels['identities'] = {};
  const compiled = new Map<string, string>();
  const render = async (value: PinnedOpencodeModel): Promise<string> => {
    const key = `${value.compute.id}@${value.compute.revision}:${value.credentialStamp}`;
    const previous = compiled.get(key); if (previous) return previous;
    const launch = await deps.compute.launchMaterialAt!({ profileId: value.compute.id, revision: value.compute.revision }, value.credentialStamp);
    const checked = pinned(value.compute, launch, value.credentialStamp);
    if (checked.model !== value.model || checked.binaryPath !== value.binaryPath) throw unavailable();
    const provider = launch.launch.opencodeProvider!, modelId = value.model.slice(provider.id.length + 1);
    const alias = `cs-platform-${new Bun.CryptoHasher('sha256').update(key).digest('hex').slice(0, 40)}`;
    const read = (name: string): string => { const secret = launch.beforeStart.secrets[name]; if (secret === undefined) throw precondition('固定 provider Secret 版本不可用', { code: 'secret_version_unavailable' }); return secret; };
    const headers = Object.fromEntries(Object.entries(provider.credentials.headers ?? {}).map(([name, ref]) => [name, read(ref)]));
    const originalHeaders = provider.options.headers;
    providers[alias] = { npm: provider.npm, ...(provider.name ? { name: provider.name } : {}), models: { [modelId]: provider.models[modelId]! }, whitelist: [modelId], options: { ...provider.options, ...(provider.credentials.apiKey ? { apiKey: read(provider.credentials.apiKey) } : {}), ...(Object.keys(headers).length ? { headers: { ...(originalHeaders && typeof originalHeaders === 'object' && !Array.isArray(originalHeaders) ? originalHeaders : {}), ...headers } } : {}) } };
    const model = `${alias}/${modelId}`;
    identities[model] = { model: value.model, computeProfileId: value.compute.id, revision: value.compute.revision };
    compiled.set(key, model); return model;
  };
  const root = await render(models.root), subagents: Record<string, string> = {};
  for (const [name, value] of Object.entries(models.subagents)) subagents[name] = await render(value);
  return PlatformOpencodeModelsSchema.parse({ version: 1, root, subagents, providers, identities });
}
