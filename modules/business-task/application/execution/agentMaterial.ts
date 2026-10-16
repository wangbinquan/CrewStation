import { businessAgentDigestInput, businessMaterialObjects, opencodeProviderSecretNames, PlatformOpencodeModelsSchema, ServiceIdSchema } from '@crewstation/contracts';
import type { AgentProfile, BusinessNativeConfig, PlatformOpencodeModels, ProjectId } from '@crewstation/contracts';
import { precondition, validation } from '@crewstation/kernel';
import type { ExecutionAgentPlan, PinnedOpencodeModel, ResolvedBusinessCompute } from '../../domain/executionAgent';
import type { ComputeLaunch } from '../../ports/runtime';
import { requireBusinessAgent } from './capabilities';
import type { BusinessExecutionDeps } from './dependencies';

export function agentPayloadDigest(command: ExecutionAgentPlan['command'], nonce: string): string {
  return new Bun.CryptoHasher('sha256').update(businessAgentDigestInput(command, nonce)).digest('hex');
}
/** Resolve only pinned project versions. A changed provider credential cannot silently alter a previously admitted attempt. */
export async function agentCommand(deps: BusinessExecutionDeps, plan: ExecutionAgentPlan, providerSecrets?: Record<string, string>): Promise<ExecutionAgentPlan['command']> {
  const ref = { profileId: plan.compute.id, revision: plan.compute.revision };
  const provider = providerSecrets ?? (await (plan.credentialStamp && deps.compute.launchMaterialAt ? deps.compute.launchMaterialAt(ref, plan.credentialStamp) : deps.compute.launchMaterial(ref))).beforeStart.secrets;
  if (plan.secretVersions.length && !deps.agentSecrets) throw precondition('项目 Secret 版本已不可用', { code: 'secret_version_unavailable' });
  const values = plan.secretVersions.length ? await deps.agentSecrets!.render(plan.projectId, plan.secretVersions) : {};
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(plan.material.env)) {
    const resolved = typeof value === 'string' ? value : values[value.secret.configDefinitionId];
    if (resolved === undefined) throw precondition('项目 Secret 版本已不可用', { code: 'secret_version_unavailable' });
    env[key] = resolved;
  }
  const mcp = plan.command.mcp.map((entry) => {
    const refs = plan.secretMcp.find((selected) => selected.name === entry.name)?.headers ?? {}, headers = { ...entry.headers };
    for (const [key, id] of Object.entries(refs)) {
      if (values[id] === undefined) throw precondition('MCP Secret 版本已不可用', { code: 'secret_version_unavailable' });
      headers[key] = values[id]!;
    }
    return { ...entry, headers };
  });
  const objects = businessMaterialObjects(plan.material);
  if (objects.length && (!deps.materialObjects || !plan.materialIdentity)) throw precondition('对象材料引用不可用', { code: 'material_objects_unpinned' });
  const downloads = objects.length ? await deps.materialObjects!.grants({ projectId: plan.projectId, serviceId: ServiceIdSchema.parse(plan.materialIdentity!.serviceId), materialId: plan.materialIdentity!.materialId, objects }) : undefined;
  const platformOpencodeModels = plan.opencodeModels ? await pinnedOpencodeModelMaterial(deps, plan.opencodeModels) : undefined;
  return { ...plan.command, ...(platformOpencodeModels ? { platformOpencodeModels } : {}), ...(downloads ? { businessMaterialDownloads: downloads } : {}), beforeStart: { ...plan.command.beforeStart, secrets: provider }, env, mcp };
}

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
  const byCompute = new Map([[`${root.compute.id}@${root.compute.revision}`, root]]), byProfile = new Map<string, PinnedOpencodeModel>();
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
/**
 * Structured provider material per stable alias (RFC-040 V12): only the pinned secret values the provider declares travel,
 * and only in the dispatch result. agent-drivers is the single renderer of OpenCode provider config.
 */
export async function pinnedOpencodeModelMaterial(deps: BusinessExecutionDeps, models: NonNullable<ExecutionAgentPlan['opencodeModels']>): Promise<PlatformOpencodeModels> {
  if (!deps.compute.launchMaterialAt) throw unavailable();
  const providers: PlatformOpencodeModels['providers'] = {}, identities: PlatformOpencodeModels['identities'] = {}, compiled = new Map<string, string>();
  const material = async (value: PinnedOpencodeModel): Promise<string> => {
    const key = `${value.compute.id}@${value.compute.revision}:${value.credentialStamp}`, previous = compiled.get(key); if (previous) return previous;
    const launch = await deps.compute.launchMaterialAt!({ profileId: value.compute.id, revision: value.compute.revision }, value.credentialStamp);
    const checked = pinned(value.compute, launch, value.credentialStamp);
    if (checked.model !== value.model || checked.binaryPath !== value.binaryPath) throw unavailable();
    const provider = launch.launch.opencodeProvider!, alias = `cs-platform-${new Bun.CryptoHasher('sha256').update(key).digest('hex').slice(0, 40)}`;
    const secrets = Object.fromEntries(opencodeProviderSecretNames(provider).map((name) => { const secret = launch.beforeStart.secrets[name]; if (secret === undefined) throw precondition('固定 provider Secret 版本不可用', { code: 'secret_version_unavailable' }); return [name, secret]; }));
    providers[alias] = { provider, secrets };
    const model = `${alias}/${value.model.slice(provider.id.length + 1)}`;
    identities[model] = { model: value.model, computeProfileId: value.compute.id, revision: value.compute.revision };
    compiled.set(key, model); return model;
  };
  const root = await material(models.root), subagents: Record<string, string> = {};
  for (const [name, value] of Object.entries(models.subagents)) subagents[name] = await material(value);
  return PlatformOpencodeModelsSchema.parse({ version: 2, root, subagents, providers, identities });
}
