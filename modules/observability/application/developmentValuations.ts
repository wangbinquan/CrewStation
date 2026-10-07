import { conflict } from '@crewstation/kernel';
import { developmentMeterKey } from "../domain/developmentNative";
import type { DevelopmentUsageLedgerStore } from '../ports/developmentUsage';
import type { ExecutionValuationStore } from '../ports/usageLedger';
import { valueDevelopmentMeter } from './developmentUsage/developmentValuationRefs';
import type { DevelopmentPreparedPage } from './developmentUsage';
import type { executionValuations } from './executionValuations';

/** Selected model evidence is durable for all meters, including unscoped and unindexed samples. */
export function valueDevelopmentUsagePage(deps: { models: DevelopmentUsageLedgerStore; store: ExecutionValuationStore;
  value: ReturnType<typeof executionValuations> }) {
  const value = valueDevelopmentMeter(deps);
  return async (page: DevelopmentPreparedPage) => {
    const refs = new Map(page.events.map(({ measurement }) => {
      const ref = { identity: measurement.identity, sourceId: measurement.sourceId, recordId: measurement.recordId };
      return [developmentMeterKey(ref), ref];
    }));
    for (const ref of refs.values()) await value(ref);
    for (const { usage } of await deps.store.pendingNativeRepairs(page, 200)) {
      if (usage.sourceId.startsWith('development-capture:')) await value({ identity: usage.identity, sourceId: usage.sourceId, recordId: usage.recordId });
    }
    if ((await deps.store.pendingNativeRepairs(page, 200)).some(({ usage }) => usage.sourceId.startsWith('development-capture:'))) throw conflict('开发历史修订估值继续处理中');
  };
}
