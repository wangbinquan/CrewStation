import { jsonHash, notFound } from '@crewstation/kernel';
import { developmentMeterKey } from '../../domain/developmentNative';
import type { DevelopmentUsageLedgerStore } from '../../ports/developmentUsage';
import type { ExecutionValuationStore, UsageMeasurementRef } from '../../ports/usageLedger';
import type { executionValuations } from '../executionValuations';

/** One original model/price validation path for ordinary pages and recovered native work. */
export function valueDevelopmentMeter(deps: { models: DevelopmentUsageLedgerStore; store: ExecutionValuationStore;
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
  return value;
}
