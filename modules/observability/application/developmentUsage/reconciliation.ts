import { DevelopmentUsagePageSchema } from '@crewstation/contracts';
import { precondition, type Logger } from '@crewstation/kernel';
import { developmentUsageIngestion, type DevelopmentPreparedPage } from '../developmentUsage';
import { prepareDevelopmentSourcePage, nativeDevelopmentPageIngestion } from './source';
import type { DevelopmentUsageSource, DevelopmentUsageLedgerStore } from '../../ports/developmentUsage';
import type { NativeDevelopmentLedgerStore } from '../../ports/nativeDevelopmentLedger';
import type { ExecutionPriceStore } from '../../ports/tokenPricing';
import type { nativeDevelopmentWork } from './nativeDevelopmentWork';

export function originalDevelopmentReconciliation(deps: { source: DevelopmentUsageSource;
  store: DevelopmentUsageLedgerStore & NativeDevelopmentLedgerStore; pricing: Pick<ExecutionPriceStore, 'get'>;
  value: (page: DevelopmentPreparedPage) => Promise<void>; native: ReturnType<typeof nativeDevelopmentWork>;
  logger: Pick<Logger, 'warn'> }) {
  const ordinary = developmentUsageIngestion(deps.store), original = nativeDevelopmentPageIngestion(deps.store);
  let pending: Promise<number> | undefined;
  const drain = async () => {
    let completed = 0;
    for (let count = 0; count < 20; count++) {
      const source = await deps.source.next(); if (!source) break;
      try {
        const page = DevelopmentUsagePageSchema.parse(source), registration = await deps.source.registration(page.key), owner = await deps.source.resolve(page.key);
        if (!registration || !owner) throw precondition('开发数值来源尚未完成独立原键映射');
        const price = await deps.pricing.get(registration.identity);
        if (!price) throw precondition('开发执行缺少原人民币受理');
        const input = await prepareDevelopmentSourcePage(page, owner, registration, price, deps.source.nativePage?.bind(deps.source));
        if ('kind' in input) await original(input); else { await ordinary(input); await deps.value(input); }
        // The original packets and work are durable before ordinary ACK; raw pages remain in Session PG.
        await deps.source.acknowledge(page.key, page.through); completed++;
      } catch { deps.logger.warn('development usage awaiting durable reconciliation', { executionId: source.key.executionId }); }
    }
    let after: string | null = null;
    for (;;) {
      const page = await deps.store.pendingNativeDevelopment(after, 100);
      for (const item of page.items) {
        try { if ((await deps.native(item)).processed) completed++; }
        catch { deps.logger.warn('native usage awaiting durable reconciliation', { passKey: item.passKey }); }
      }
      if (page.nextCursor === null) break; after = page.nextCursor;
    }
    return completed;
  };
  return () => pending ??= drain().finally(() => { pending = undefined; });
}
