import { PlatformOpencodeModelsSchema } from '@crewstation/contracts';
import type { OpencodeProvider } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';
import type { AgentSpawnContext } from '../../contract/spawnPlan';

/**
 * The only rendering of administrator provider material into OpenCode's `provider` config (RFC-040 V12).
 * The profile's own provider and every platform alias of a pinned sub-agent profile go through here.
 */
export function renderOpencodeProvider(provider: OpencodeProvider, modelIds: readonly string[], read: (name: string) => string): Record<string, unknown> {
  const headers = Object.fromEntries(Object.entries(provider.credentials.headers ?? {}).map(([name, ref]) => [name, read(ref)]));
  const existing = provider.options.headers;
  const options = { ...provider.options, ...(provider.credentials.apiKey ? { apiKey: read(provider.credentials.apiKey) } : {}), ...(Object.keys(headers).length ? { headers: { ...(existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}), ...headers } } : {}) };
  return { npm: provider.npm, ...(provider.name ? { name: provider.name } : {}), options, models: Object.fromEntries(modelIds.map((id) => [id, provider.models[id]])), whitelist: [...modelIds] };
}

/** Only platform material supplies model/provider selections. Never merge providers from business options. */
export function opencodeModelConfig(ctx: AgentSpawnContext): Record<string, unknown> {
  const compiled = ctx.platformOpencodeModels;
  if (compiled) {
    const material = PlatformOpencodeModelsSchema.parse(compiled), wanted = new Map<string, Set<string>>();
    for (const model of [material.root, ...Object.values(material.subagents)]) {
      const slash = model.indexOf('/'), alias = model.slice(0, slash), id = model.slice(slash + 1), entry = material.providers[alias];
      if (slash < 1 || !entry || !Object.hasOwn(entry.provider.models, id) || !material.identities[model]) throw validation('平台模型映射不完整', { code: 'invalid_configuration' });
      wanted.set(alias, (wanted.get(alias) ?? new Set()).add(id));
    }
    const agents = ctx.businessNativeConfig?.subagents ?? [];
    if (Object.keys(material.subagents).some((name) => !agents.some((agent) => agent.name === name && agent.agentProfileId)) || agents.some((agent) => agent.agentProfileId && !material.subagents[agent.name])) throw validation('平台模型映射与业务子代理不一致', { code: 'invalid_configuration' });
    const provider = Object.fromEntries([...wanted].map(([alias, ids]) => {
      const entry = material.providers[alias]!;
      return [alias, renderOpencodeProvider(entry.provider, [...ids].sort(), (name) => { const value = entry.secrets[name]; if (value === undefined) throw validation('平台模型材料缺少声明的凭据', { code: 'profile_secret_missing' }); return value; })];
    }));
    return { model: material.root, small_model: material.root, enabled_providers: Object.keys(provider), provider };
  }
  if (ctx.businessNativeConfig?.subagents.some((agent) => agent.agentProfileId)) throw validation('业务子代理缺少固定平台模型材料', { code: 'unsupported_capability' });
  const provider = ctx.opencodeProvider;
  if (!provider) return {};
  const model = ctx.model, prefix = `${provider.id}/`;
  if (!model?.startsWith(prefix) || !Object.hasOwn(provider.models, model.slice(prefix.length))) throw validation('结构化 provider 中没有档位模型');
  const read = (name: string): string => { const value = ctx.baseEnv[name]; if (value === undefined) throw validation('结构化 provider 缺少声明的凭据', { code: 'profile_secret_missing' }); return value; };
  return { model, small_model: model, enabled_providers: [provider.id], provider: { [provider.id]: renderOpencodeProvider(provider, [model.slice(prefix.length)], read) } };
}

export function opencodeOriginalModels(ctx: Pick<AgentSpawnContext, 'platformOpencodeModels'>): Record<string, string> | undefined {
  return ctx.platformOpencodeModels ? Object.fromEntries(Object.entries(ctx.platformOpencodeModels.identities).map(([alias, identity]) => [alias, identity.model])) : undefined;
}
