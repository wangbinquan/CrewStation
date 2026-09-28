import type { Actor, SaveTokenPrice, TokenPriceVersion } from '@crewstation/contracts';
import { SaveTokenPriceSchema } from '@crewstation/contracts';
import { conflict, forbidden, newResourceId, notFound, validation } from '@crewstation/kernel';
import type { Clock } from '@crewstation/kernel';
import type { TokenPricingApi } from '../api/tokenPricingApi';
import type { PricingProfileDirectory, TokenPriceStore } from '../ports/tokenPricing';

export interface TokenPricingDeps {
  store: TokenPriceStore; profiles: PricingProfileDirectory; clock: Clock;
}
function admin(actor: Actor): void { if (!actor.isAdmin) throw forbidden('只有系统管理员可以管理 Token 成本'); }
function fingerprint(input: SaveTokenPrice): string {
  // Schema parse fixes property order and defaults before deriving this request identity.
  return JSON.stringify(input);
}
async function save(deps: TokenPricingDeps, actor: Actor, profileId: string, raw: SaveTokenPrice): Promise<TokenPriceVersion> {
  admin(actor);
  const parsed = SaveTokenPriceSchema.safeParse(raw);
  if (!parsed.success) throw validation('Token 单价配置无效', { issues: parsed.error.issues });
  const input = parsed.data, signature = fingerprint(input);
  // The directory uses the base pool; read before reserving the pricing transaction.
  // The receipt still wins before validating a deleted or changed profile.
  const profile = (await deps.profiles.list(actor)).find((row) => row.id === profileId);
  return deps.store.change(profileId, async (scope) => {
    const receipt = await scope.receipt(profileId, input.requestKey);
    if (receipt) {
      if (receipt.fingerprint !== signature) throw conflict('相同请求标识对应不同价格内容');
      return receipt.version;
    }
    if (!profile) throw notFound('算力档位', profileId);
    if (profile.revision !== input.profileRevision || profile.protocol !== input.protocol) throw conflict('算力档位已变更，请刷新后核对价格', { code: 'profile_revision_conflict', profileRevision: profile.revision });
    const revision = await scope.head(profileId);
    if (revision !== input.expectedRevision) throw conflict('价格已由另一位管理员更新，请保留草稿并刷新', { revision });
    const now = deps.clock.now(), at = Date.parse(input.effectiveFrom);
    if (at < now.getTime()) throw validation('新价格的生效时间不能早于保存时间');
    const previous = await scope.latestMatch(profileId, input);
    if (previous && at <= Date.parse(previous.effectiveFrom)) throw conflict('同一模型的新价格须晚于已登记版本生效');
    const version: TokenPriceVersion = {
      id: newResourceId(), profileId, revision: revision + 1,
      profileRevision: input.profileRevision, protocol: input.protocol, provider: input.provider,
      model: input.model, condition: input.condition, currency: 'CNY', rates: input.rates,
      effectiveFrom: new Date(at).toISOString(), sourceNote: input.sourceNote,
      createdAt: now.toISOString(), createdBy: actor.userId,
    };
    await scope.append(version, input.requestKey, signature);
    return version;
  });
}
export function tokenPricingUseCases(deps: TokenPricingDeps): TokenPricingApi {
  return {
    pricingProfiles: async (actor) => {
      admin(actor);
      const profiles = await deps.profiles.list(actor);
      const heads = await deps.store.heads(profiles.map((row) => row.id));
      return { items: profiles.map((row) => ({ ...row, pricingRevision: heads.get(row.id) ?? 0 })) };
    },
    priceHistory: async (actor, profileId, query) => {
      admin(actor);
      const items = await deps.store.history(profileId, { ...query, limit: query.limit + 1 });
      const revision = (await deps.store.heads([profileId])).get(profileId) ?? 0;
      const more = items.length > query.limit;
      const page = items.slice(0, query.limit);
      return { items: page, revision, ...(more ? { nextBeforeRevision: page.at(-1)!.revision } : {}) };
    },
    savePrice: (actor, profileId, input) => save(deps, actor, profileId, input),
  };
}
