import { RunnerUsageCaptureSchema, type RunnerUsageSourcePage, type ExecutionObservationIdentity, ExecutionUsageObservationSchema, ProjectIdSchema, TaskIdSchema } from '@crewstation/contracts';
import { conflict, jsonHash, precondition, validation, type Logger } from '@crewstation/kernel';
import { z } from 'zod';
import { rebuildUsageProjection, type UsageEvidence } from '../domain/usageProjection';
import type { RunnerUsageSource, UsageLedgerStore, UsageLedgerTransaction, UsageSourcePage } from '../ports/usageLedger';

const key = z.string().min(1).max(512);
const evidenceSchema = z.strictObject(ExecutionUsageObservationSchema.shape).omit({ projection: true });
const pageSchema = z.strictObject({
  projectId: ProjectIdSchema, taskId: TaskIdSchema, sourceId: key,
  expectedCursor: key.nullable(), nextCursor: key,
  events: z.array(z.strictObject({ eventId: key, measurement: evidenceSchema })).max(500),
});
function parsedPage(input: UsageSourcePage): UsageSourcePage {
  const parsed = pageSchema.safeParse(input);
  if (!parsed.success || input.expectedCursor === input.nextCursor) throw validation('用量来源页或游标无效');
  for (const { measurement } of parsed.data.events) {
    if (measurement.identity.projectId !== input.projectId || measurement.identity.taskId !== input.taskId || measurement.sourceId !== input.sourceId)
      throw validation('用量证据与来源页身份不一致');
    // Complete public cross-field checks use an honest initial projection.
    ExecutionUsageObservationSchema.parse(rebuildUsageProjection([measurement]));
  }
  return parsed.data;
}
async function append(tx: UsageLedgerTransaction, event: UsageSourcePage['events'][number]): Promise<boolean> {
  const fingerprint = jsonHash(event.measurement), priorEvent = await tx.eventFingerprint(event.eventId);
  if (priorEvent !== undefined) {
    if (priorEvent !== fingerprint) throw conflict('来源事件内容冲突');
    return false;
  }
  const revision = await tx.revisionFingerprint(event.measurement);
  if (revision !== undefined && revision !== fingerprint) throw conflict('原生用量修订冲突');
  if (revision === undefined) {
    const retained: UsageEvidence[] = [];
    let after = 0;
    while (true) {
      const page = await tx.evidence(event.measurement, after, 200);
      retained.push(...page);
      if (page.length < 200) break;
      after = page.at(-1)!.revision;
    }
    const previous = await tx.current(event.measurement);
    const projection = rebuildUsageProjection([...retained, event.measurement], previous);
    ExecutionUsageObservationSchema.parse(projection);
    if (projection !== previous) await tx.project(projection);
  }
  await tx.append(event, fingerprint);
  return revision === undefined;
}

/** Retained evidence, replacement projection, sync log and source cursor commit together. */
export function usageIngestion(store: UsageLedgerStore) {
  return async (raw: UsageSourcePage) => {
    const input = parsedPage(raw), fingerprint = jsonHash(input);
    return store.change(input, input.sourceId, async (tx) => {
      const receipt = await tx.pageFingerprint(input.nextCursor);
      if (receipt !== undefined) {
        if (receipt !== fingerprint) throw conflict('来源页重放内容冲突');
        return { cursor: await tx.cursor(), applied: 0, duplicate: input.events.length };
      }
      if (await tx.cursor() !== input.expectedCursor) throw conflict('来源游标已更新');
      let applied = 0;
      for (const event of input.events) if (await append(tx, event)) applied++;
      await tx.advance(input.nextCursor, fingerprint);
      return { cursor: input.nextCursor, applied, duplicate: input.events.length - applied };
    });
  };
}

function runnerPage(page: RunnerUsageSourcePage, identity: ExecutionObservationIdentity): UsageSourcePage {
  if (identity.executionId !== page.executionId || identity.executionGeneration !== page.attempt || !Number.isSafeInteger(page.after) || page.after < 0 ||
      page.events.length < 1 || page.events.length > 5 || page.through !== page.events.at(-1)?.sequence) throw validation('数值来源页身份或水位不一致');
  const sourceId = 'runner:' + jsonHash({ runtimeTaskId: page.runtimeTaskId, executionId: page.executionId, attempt: page.attempt, incarnation: page.incarnation, payloadDigest: page.payloadDigest });
  let previous = page.after;
  const events = page.events.flatMap((event) => {
    if (!Number.isSafeInteger(event.sequence) || event.sequence <= previous) throw validation('数值来源事件水位不连续递增');
    previous = event.sequence;
    return RunnerUsageCaptureSchema.parse(event.capture).measurements.map(({ actualModel, ...measurement }, index) => ({
      eventId: `runner:${event.sequence}:${index}`, measurement: { ...measurement, kind: 'usage' as const, identity, sourceId,
        modelRef: actualModel === null ? null : jsonHash(actualModel) },
    }));
  });
  return { projectId: identity.projectId, taskId: identity.taskId, sourceId, expectedCursor: page.after === 0 ? null : `runner:${page.after}`, nextCursor: `runner:${page.through}`, events };
}

/** The source is acknowledged only after evidence, projection and cursor have committed together. */
export function runnerUsageReconciliation(deps: { source: RunnerUsageSource; store: UsageLedgerStore; value: (sourcePage: RunnerUsageSourcePage, page: UsageSourcePage) => Promise<void>; logger: Pick<Logger, 'warn'> }) {
  const ingest = usageIngestion(deps.store);
  let pending: Promise<number> | undefined;
  const drain = async () => {
    let completed = 0;
    for (let count = 0; count < 20; count++) {
      const page = await deps.source.next();
      if (!page) break;
      try {
        const identity = await deps.source.resolve(page);
        if (!identity) throw precondition('执行数值来源尚未完成归属映射');
        const input = runnerPage(page, identity);
        await ingest(input);
        await deps.value(page, input);
        await deps.source.acknowledge(page.runtimeTaskId, page.executionId, page.through);
        completed++;
      } catch { deps.logger.warn('execution usage awaiting durable reconciliation', { executionId: page.executionId }); }
    }
    return completed;
  };
  return () => pending ??= drain().finally(() => { pending = undefined; });
}
