import { DevelopmentUsagePageSchema, UsageRecordSchema,
  type DevelopmentUsagePage, type DevelopmentUsageRegistration } from '@crewstation/contracts';
import { conflict, jsonHash, precondition, type Logger } from '@crewstation/kernel';
import { developmentCaptureSourceId, developmentStreamId, type DevelopmentNativeContext } from '../domain/developmentNative';
import { type DevelopmentModelEvidence } from "../domain/developmentNative";
import { rebuildUsageProjection } from '../domain/usageProjection';
import type { DevelopmentUsageLedgerStore, DevelopmentUsageSource, DevelopmentUsageResolved } from '../ports/developmentUsage';
import type { AcceptedExecutionPrice, ExecutionPriceStore } from '../ports/tokenPricing';
import type { UsageSourcePage } from '../ports/usageLedger';
import { appendUsageEvidence } from './usageIngestion';
import { prepareDevelopmentAdmission } from './developmentUsage/admission';

export interface DevelopmentPreparedPage extends Omit<UsageSourcePage, 'native'> {
  context: DevelopmentNativeContext; source: DevelopmentUsagePage;
  models: DevelopmentModelEvidence[]; fingerprint: string;
}
/** Independent persisted Session registration and original accepted price are checked before any write. */
export function prepareDevelopmentUsagePage(raw: DevelopmentUsagePage, owner: DevelopmentUsageResolved,
  session: DevelopmentUsageRegistration, accepted: AcceptedExecutionPrice): DevelopmentPreparedPage {
  if (owner.nativeSelection?.version === 2) throw precondition('原生 v2 尚未装配平台投影，不能确认或丢弃原数字页');
  return prepareRecordedDevelopmentPage(raw, owner, session, accepted);
}
/** Restore only actual legacy facts; the original v2 selection stays frozen and incomplete. */
export function prepareDevelopmentVersionRecovery(raw: DevelopmentUsagePage, owner: DevelopmentUsageResolved,
  session: DevelopmentUsageRegistration, accepted: AcceptedExecutionPrice): DevelopmentPreparedPage {
  if (owner.nativeSelection?.version !== 2) throw precondition('版本错配恢复必须绑定原 v2 选择');
  return prepareRecordedDevelopmentPage(raw, owner, session, accepted);
}
function prepareRecordedDevelopmentPage(raw: DevelopmentUsagePage, owner: DevelopmentUsageResolved,
  session: DevelopmentUsageRegistration, accepted: AcceptedExecutionPrice): DevelopmentPreparedPage {
  const { source, registration } = prepareDevelopmentAdmission(raw, owner, session, accepted);
  const choice = owner.nativeSelection;
  if (choice && (![1, 2].includes(choice.version) || !choice.expectedNamespace || choice.expectedNamespace.length > 512)) throw precondition('开发原生来源原选择无效');
  const streamSourceId = developmentStreamId(registration), context: DevelopmentNativeContext = {
    registration, streamSourceId, ...(choice ? { selection: { version: choice.version, expectedNamespace: choice.expectedNamespace } } : {}),
  };
  const events: UsageSourcePage['events'] = [], models: DevelopmentModelEvidence[] = [];
  for (const event of source.events) {
    const frame = event.capture;
    if (frame.version !== 1) throw precondition('原生 v2 尚未装配平台投影，不能确认或丢弃原数字页');
    if (frame.nativeSource && !choice || choice && [frame.nativeProof?.lineageKey, frame.nativeBaseline?.lineageKey].some((ns) => ns !== undefined && ns !== choice.expectedNamespace)) throw conflict('开发原生来源与冻结选择不符');
    for (const [index, { actualModel, ...rawMeasurement }] of frame.measurements.entries()) {
      const sourceId = developmentCaptureSourceId(streamSourceId, rawMeasurement.scope?.turn ?? null, rawMeasurement.scope?.turnIndex ?? null);
      const measurement = { ...rawMeasurement, kind: 'usage' as const, identity: registration.identity, sourceId,
        modelRef: actualModel === null ? null : jsonHash(actualModel) };
      UsageRecordSchema.parse(rebuildUsageProjection([measurement]));
      events.push({ eventId: `development:${event.sequence}:${index}`, measurement });
      models.push({ meter: { identity: measurement.identity, sourceId, recordId: measurement.recordId }, revision: measurement.revision,
        streamSourceId, sequence: event.sequence, index, turn: measurement.scope?.turn ?? null, turnIndex: measurement.scope?.turnIndex ?? null,
        measurementFingerprint: jsonHash(measurement), actualModel, modelRef: measurement.modelRef });
    }
  }
  return { projectId: registration.identity.projectId, taskId: registration.identity.taskId, sourceId: streamSourceId,
    expectedCursor: source.after === 0 ? null : `development:${source.after}`, nextCursor: `development:${source.through}`,
    source, context, events, models, fingerprint: jsonHash({ source, registration, selection: context.selection ?? null, price: owner.price }) };
}
export function developmentUsageIngestion(store: DevelopmentUsageLedgerStore) {
  return (page: DevelopmentPreparedPage) => store.changeDevelopment(page, page.sourceId, async (tx) => {
    const receipt = await tx.pageFingerprint(page.nextCursor);
    if (receipt !== undefined) {
      if (receipt !== page.fingerprint) throw conflict('开发来源页重放内容冲突');
      return { cursor: await tx.cursor(), applied: 0, duplicate: page.events.length };
    }
    if (await tx.cursor() !== page.expectedCursor) throw conflict('开发数值来源游标已更新');
    let applied = 0;
    for (const [index, event] of page.events.entries()) {
      await tx.developmentModel(page.models[index]!);
      if (await appendUsageEvidence(tx, event)) applied++;
    }
    for (const event of page.source.events) {
      if (event.capture.version !== 1) throw precondition('原生 v2 尚未装配平台投影');
      await tx.developmentCapture(page.context, event.capture);
    }
    await tx.advance(page.nextCursor, page.fingerprint);
    return { cursor: page.nextCursor, applied, duplicate: page.events.length - applied };
  });
}
/** Single-flight, fixed-page reconciliation never uses the ambiguous record-only Session lookup. */
export function developmentUsageReconciliation(deps: { source: DevelopmentUsageSource; store: DevelopmentUsageLedgerStore;
  pricing: Pick<ExecutionPriceStore, 'get'>; value: (page: DevelopmentPreparedPage) => Promise<void>; logger: Pick<Logger, 'warn'> }) {
  const ingest = developmentUsageIngestion(deps.store);
  let pending: Promise<number> | undefined;
  const drain = async () => {
    let completed = 0;
    for (let count = 0; count < 20; count++) {
      const source = await deps.source.next();
      if (!source) break;
      try {
        const page = DevelopmentUsagePageSchema.parse(source);
        const registration = await deps.source.registration(page.key), owner = await deps.source.resolve(page.key);
        if (!registration || !owner) throw precondition('开发数值来源尚未完成独立原键映射');
        const price = await deps.pricing.get(registration.identity);
        if (!price) throw precondition('开发执行缺少原人民币受理');
        const input = prepareDevelopmentUsagePage(page, owner, registration, price);
        await ingest(input);
        await deps.value(input);
        await deps.source.acknowledge(page.key, page.through);
        completed++;
      } catch { deps.logger.warn('development usage awaiting durable reconciliation', { executionId: source.key.executionId }); }
    }
    return completed;
  };
  return () => pending ??= drain().finally(() => { pending = undefined; });
}
