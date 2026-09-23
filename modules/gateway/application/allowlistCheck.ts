import type { AllowlistDrift } from '../domain/allowlistDrift';
import type { GatewayUseCaseDeps } from './dependencies';
import { currentRoute } from './reconcileRoutes';

export type AllowlistCheck = AllowlistDrift & { readonly version: number };

/**
 * 放行表定时核对的一轮（RFC-025 设计 §7.4）：核对，不一致时重算一版；配了资源台账时把结果写进每个服务的服务域路由记录的条件
 * `AllowlistDrift`——这一轮有出入的为真（写明重算到第几版），其余为假；台账对同样的条件不写库。
 */
export async function checkAllowlist(deps: Pick<GatewayUseCaseDeps, 'ledger' | 'services'>, verify: () => Promise<AllowlistCheck>): Promise<AllowlistCheck> {
  const result = await verify();
  const ledger = deps.ledger;
  if (!ledger) return result;
  const drifted = new Set(result.callers);
  for (const service of await deps.services.listServices()) {
    const { record } = await currentRoute(ledger, service.serviceId, 'service');
    if (!record) continue;
    const condition = result.global || drifted.has(service.identity)
      ? { type: 'AllowlistDrift', status: 'true' as const, reason: 'repaired', message: `定时核对发现放行表与当前授权不一致，已重算为第 ${result.version} 版` }
      : { type: 'AllowlistDrift', status: 'false' as const };
    await ledger.report(record.id, { conditions: [condition] });
  }
  return result;
}
