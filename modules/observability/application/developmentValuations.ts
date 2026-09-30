import { jsonHash, notFound, conflict } from '@crewstation/kernel';
import { developmentMeterKey } from '../domain/developmentModelEvidence';
import type { DevelopmentUsageLedgerStore } from '../ports/developmentUsage';
import type { ExecutionValuationStore, UsageMeasurementRef } from '../ports/usageLedger';
import type { DevelopmentPreparedPage } from './developmentUsage';
import type { executionValuations } from './executionValuations';

/** Selected model evidence is durable for all meters, including unscoped and unindexed samples. */
export function valueDevelopmentUsagePage(deps: { models: DevelopmentUsageLedgerStore; store: ExecutionValuationStore;
  value: ReturnType<typeof executionValuations> }) {
  const value = async (ref: UsageMeasurementRef) => {
    const current = await deps.store.usage(ref);
    if (!current) throw notFound('已提交开发用量投影尚不可读取');
    const revision = current.projection.modelRevision ?? current.revision;
    const evidence = await deps.models.developmentModel(ref, revision);
    if (!evidence || developmentMeterKey(evidence.meter) !== developmentMeterKey(ref) || evidence.revision !== revision ||
        evidence.turn !== (current.scope?.turn ?? null) || evidence.turnIndex !== (current.scope?.turnIndex ?? null) ||
        evidence.modelRef !== current.modelRef || (evidence.actualModel === null ? null : jsonHash(evidence.actualModel)) !== current.modelRef) throw notFound('开发所选修订缺少精确原模型证据');
    const actual = evidence.actualModel;
    const model = actual?.provider && actual.model ? { provider: actual.provider, model: actual.model, condition: actual.condition } : null;
    const input = { measurement: ref, usageRevision: current.projection.projectionRevision, model };
    await deps.value({ ...input, requestKey: jsonHash(input) });
  };
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
