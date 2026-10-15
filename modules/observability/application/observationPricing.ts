// RFC-034 v2 §3.3–§3.4 —— 价格线（算力档位 × 实际模型）与项目费用可见性；写入仅管理员
// （与 agent-workflow RFC-371 v2 `application/pricing.ts` 同一规则：保存以 expectedLatestId 做 CAS）。

import type {
  Actor, ObservationPrice, ObservationPriceHistory, ObservationPricingDirectory, ObservationPricingProfile, ProjectCostVisibility, ProjectId,
  SaveObservationPriceInput, SetProjectCostVisibility,
} from '@crewstation/contracts';
import { SaveObservationPriceSchema, SetProjectCostVisibilitySchema, observationBuiltinProtocol, observationMicroToRate, observationRateToMicro } from '@crewstation/contracts';
import { conflict, forbidden, newResourceId, notFound } from '@crewstation/kernel';
import type { PriceVersion } from '../domain/agentCallPricing';
import type { AgentCallStore } from '../ports/agentCalls';
import type { CostVisibilityStore, PriceStore, PricingProfileDirectory } from '../ports/observationPricing';

/** 有内置价格线的协议（没有算力档位的执行）。 */
export const OBSERVATION_BUILTIN_PROTOCOLS = ['opencode', 'claude-code'] as const;

export interface ObservationPricing {
  directory(actor: Actor): Promise<ObservationPricingDirectory>;
  history(actor: Actor, profileId: string, model: string): Promise<ObservationPriceHistory>;
  save(actor: Actor, profileId: string, input: SaveObservationPriceInput): Promise<ObservationPrice>;
  costVisibility(actor: Actor, projectId: ProjectId): Promise<ProjectCostVisibility>;
  setCostVisibility(actor: Actor, projectId: ProjectId, input: SetProjectCostVisibility): Promise<ProjectCostVisibility>;
}

export function priceView(version: PriceVersion): ObservationPrice {
  const rate = (micro: number | null) => (micro === null ? null : observationMicroToRate(micro));
  return {
    id: version.id, profileId: version.profileId, model: version.model,
    rates: { input: rate(version.inputMicro), cacheRead: rate(version.cacheReadMicro), cacheWrite: rate(version.cacheWriteMicro), output: rate(version.outputMicro) },
    effectiveFrom: new Date(version.effectiveFrom).toISOString(), createdAt: new Date(version.createdAt).toISOString(), createdBy: version.createdBy, note: version.note,
  };
}

const newest = (a: PriceVersion, b: PriceVersion) => b.createdAt - a.createdAt || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0);
const isBuiltin = (profileId: string) => (OBSERVATION_BUILTIN_PROTOCOLS as readonly string[]).includes(observationBuiltinProtocol(profileId) ?? '');

/** 一个档位的价格线：配置的模型、实际出现过的每个模型、每条已定价的模型。 */
function priceLines(profileId: string, configuredModel: string | null, seen: readonly { profileId: string; model: string; calls: number }[], versions: readonly PriceVersion[]): ObservationPricingProfile['models'] {
  const lines = new Map<string, { calls: number; versions: PriceVersion[] }>();
  const line = (model: string) => {
    const found = lines.get(model) ?? { calls: 0, versions: [] };
    lines.set(model, found);
    return found;
  };
  if (configuredModel) line(configuredModel);
  for (const row of seen) if (row.profileId === profileId && row.model !== '') line(row.model).calls += row.calls;
  for (const version of versions) if (version.profileId === profileId) line(version.model).versions.push(version);
  return [...lines.entries()]
    .map(([model, value]) => ({ model, calls: value.calls, current: value.versions.length ? priceView([...value.versions].sort(newest)[0]!) : null }))
    .sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model));
}

function requireAdmin(actor: Actor): void {
  if (!actor.isAdmin) throw forbidden();
}

export function observationPricing(deps: {
  readonly prices: PriceStore; readonly calls: Pick<AgentCallStore, 'profileModels'>; readonly profiles: PricingProfileDirectory;
  readonly visibility: CostVisibilityStore; readonly clock?: () => number;
}): ObservationPricing {
  const clock = deps.clock ?? Date.now;
  return {
    async directory(actor) {
      requireAdmin(actor);
      const [profiles, versions, seen] = await Promise.all([deps.profiles.list(actor), deps.prices.all(), deps.calls.profileModels()]);
      // 内置价格线在有执行或已有价格时才出现。
      const builtin = [...new Set([...seen.map((row) => row.profileId), ...versions.map((version) => version.profileId)].filter(isBuiltin))].sort();
      return { profiles: [
        ...profiles.map((profile) => ({ profileId: profile.id, name: profile.name, protocol: profile.protocol, builtin: false, configuredModel: profile.model,
          models: priceLines(profile.id, profile.model, seen, versions) })),
        ...builtin.map((profileId) => {
          const protocol = observationBuiltinProtocol(profileId)!;
          return { profileId, name: protocol, protocol, builtin: true, configuredModel: null, models: priceLines(profileId, null, seen, versions) };
        }),
      ] };
    },
    async history(actor, profileId, model) {
      requireAdmin(actor);
      return { items: [...await deps.prices.line(profileId, model)].sort(newest).map(priceView) };
    },
    async save(actor, profileId, raw) {
      requireAdmin(actor);
      const input = SaveObservationPriceSchema.parse(raw);
      if (!isBuiltin(profileId) && !(await deps.profiles.list(actor)).some((profile) => profile.id === profileId)) throw notFound('算力档位', profileId);
      const micro = (rate: string | null) => (rate === null ? null : observationRateToMicro(rate));
      const version: PriceVersion = {
        id: newResourceId(), profileId, model: input.model, inputMicro: micro(input.rates.input), cacheReadMicro: micro(input.rates.cacheRead),
        cacheWriteMicro: micro(input.rates.cacheWrite), outputMicro: micro(input.rates.output), effectiveFrom: Date.parse(input.effectiveFrom),
        createdAt: clock(), createdBy: actor.userId, note: input.note,
      };
      if ((await deps.prices.append(version, input.expectedLatestId)) === 'conflict')
        throw conflict('这条价格线在打开后已被修改，请刷新后再保存', { code: 'price_conflict' });
      return priceView(version);
    },
    async costVisibility(actor, projectId) {
      requireAdmin(actor);
      const record = await deps.visibility.read(projectId);
      return { projectId, visible: record?.visible === true, updatedAt: record ? record.updatedAt.toISOString() : null };
    },
    async setCostVisibility(actor, projectId, raw) {
      requireAdmin(actor);
      const input = SetProjectCostVisibilitySchema.parse(raw);
      const record = await deps.visibility.write({ projectId, visible: input.visible, updatedAt: new Date(clock()), updatedBy: actor.userId });
      return { projectId, visible: record.visible, updatedAt: record.updatedAt.toISOString() };
    },
  };
}
