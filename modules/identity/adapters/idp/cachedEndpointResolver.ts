import type { Clock } from '@crewstation/kernel';
import { systemClock } from '@crewstation/kernel';
import type { DiscoveryDocument, EffectiveEndpoints, EndpointConfig } from '../../domain/endpointResolution';
import { loginViable, mergeEndpoints } from '../../domain/endpointResolution';
import type { EndpointResolver, IdpClient } from '../../ports/idpClient';

const POSITIVE_TTL_MS = 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 5 * 60 * 1000;

interface PositiveEntry { readonly doc: DiscoveryDocument; readonly at: number }
interface NegativeEntry { readonly error: string; readonly at: number }

/**
 * 缓存纪律（与 agent-workflow 的 RFC-220 同义，逐条搬过来）：
 *   - 失败只按失败缓存，绝不缓存成一次成功；
 *   - 命中只在合并结果 `loginViable` 时才认——「半可用」的组合从缓存返回，会把一次瞬时故障放大成一小时不可登录；
 *   - 管理员按「测试连接」时强制取新，并用新结果回填缓存。
 */
export function cachedEndpointResolver(client: IdpClient, clock: Clock = systemClock): EndpointResolver {
  const positive = new Map<string, PositiveEntry>();
  const negative = new Map<string, NegativeEntry>();
  return {
    resolve: async (provider: EndpointConfig, options): Promise<EffectiveEndpoints> => {
      const now = clock.now().getTime();
      if (options?.forceFresh !== true) {
        const cachedFailure = negative.get(provider.issuerUrl);
        if (cachedFailure && now - cachedFailure.at < NEGATIVE_TTL_MS) {
          const manualOnly = mergeEndpoints(null, provider, { ok: false, error: cachedFailure.error });
          // 读侧再判一次：窗口期内管理员可能刚补上手工端点，判定要按当前配置而不是当时配置。
          if (loginViable(manualOnly, provider)) return manualOnly;
        }
        const cachedDoc = positive.get(provider.issuerUrl);
        if (cachedDoc && now - cachedDoc.at < POSITIVE_TTL_MS) {
          const merged = mergeEndpoints(cachedDoc.doc, provider, { ok: true });
          if (loginViable(merged, provider)) return merged;
        }
      }
      try {
        const doc = await client.discover(provider.issuerUrl);
        positive.set(provider.issuerUrl, { doc, at: now });
        negative.delete(provider.issuerUrl);
        return mergeEndpoints(doc, provider, { ok: true });
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        const manualOnly = mergeEndpoints(null, provider, { ok: false, error: text });
        // 新失败是关于这个 issuer 的最新事实：留着旧的成功条目，会在更短的负缓存过期后复活最多一小时前的端点。
        positive.delete(provider.issuerUrl);
        if (loginViable(manualOnly, provider)) negative.set(provider.issuerUrl, { error: text, at: now });
        return manualOnly;
      }
    },
  };
}
