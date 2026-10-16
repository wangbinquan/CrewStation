import { PlatformOpencodeModelsSchema } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';
import type { AgentSpawnContext } from '../../contract/spawnPlan';

/** Only platform material supplies model/provider selections. Never merge providers from business options. */
export function opencodeModelConfig(ctx: AgentSpawnContext): Record<string, unknown> {
  const compiled = ctx.platformOpencodeModels;
  if (compiled) {
    const material = PlatformOpencodeModelsSchema.parse(compiled);
    const selected = [material.root, ...Object.values(material.subagents)];
    for (const model of selected) {
      const slash = model.indexOf('/'), provider = material.providers[model.slice(0, slash)], id = model.slice(slash + 1);
      if (!provider || !provider.whitelist.includes(id) || !Object.hasOwn(provider.models, id) || !material.identities[model]) throw validation('平台模型映射不完整', { code: 'invalid_configuration' });
    }
    const agents = ctx.businessNativeConfig?.subagents ?? [];
    if (Object.keys(material.subagents).some((name) => !agents.some((agent) => agent.name === name && agent.agentProfileId)) || agents.some((agent) => agent.agentProfileId && !material.subagents[agent.name])) throw validation('平台模型映射与业务子代理不一致', { code: 'invalid_configuration' });
    return { model: material.root, small_model: material.root, enabled_providers: Object.keys(material.providers), provider: material.providers };
  }
  if (ctx.businessNativeConfig?.subagents.some((agent) => agent.agentProfileId)) throw validation('业务子代理缺少固定平台模型材料', { code: 'unsupported_capability' });
  const provider = ctx.opencodeProvider;
  if (!provider) return {};
  const model = ctx.model, prefix = `${provider.id}/`;
  if (!model?.startsWith(prefix) || !Object.hasOwn(provider.models, model.slice(prefix.length))) throw validation('结构化 provider 中没有档位模型');
  const read = (name: string): string => { const value = ctx.baseEnv[name]; if (value === undefined) throw validation('结构化 provider 缺少声明的凭据', { code: 'profile_secret_missing' }); return value; };
  const headers = Object.fromEntries(Object.entries(provider.credentials.headers ?? {}).map(([name, ref]) => [name, read(ref)]));
  const existing = provider.options.headers;
  const options = { ...provider.options, ...(provider.credentials.apiKey ? { apiKey: read(provider.credentials.apiKey) } : {}), ...(Object.keys(headers).length ? { headers: { ...(existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}), ...headers } } : {}) };
  const id = model.slice(prefix.length);
  return { model, small_model: model, enabled_providers: [provider.id], provider: { [provider.id]: { npm: provider.npm, ...(provider.name ? { name: provider.name } : {}), options, models: { [id]: provider.models[id] }, whitelist: [id] } } };
}

export function opencodeOriginalModels(ctx: Pick<AgentSpawnContext, 'platformOpencodeModels'>): Record<string, string> | undefined {
  return ctx.platformOpencodeModels ? Object.fromEntries(Object.entries(ctx.platformOpencodeModels.identities).map(([alias, identity]) => [alias, identity.model])) : undefined;
}
