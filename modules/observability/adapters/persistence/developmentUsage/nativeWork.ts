import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { conflict, jsonHash } from '@crewstation/kernel';
import type { UsageRecord } from '@crewstation/contracts';
import type { NativeDevelopmentTransaction, NativeDevelopmentWork, NativeDevelopmentLedgerStore } from '../../../ports/nativeDevelopmentLedger';
import type { DevelopmentUsageTransaction } from '../../../ports/developmentUsage';
import type { DevelopmentNativePassMetadata, DevelopmentNativePageMetadata } from '../../../domain/developmentUsage/metadata';
import type { DevelopmentNativePassProgress } from '../../../domain/developmentUsage/progress';
import type { OriginalNativePassQualification } from '../../../domain/developmentUsage/nativeBaselineQualification';
import type { NativeStepOwnerReceipt } from '../../../domain/developmentUsage/nativeStepOwner';
import type { CompleteNativePath } from '../../../ports/completeNativeScope';
import { readNativePathQualification } from './nativePathQualification';
import { readDevelopmentModel } from '../developmentUsageModels';
import { persistNativeReference } from './nativeReferences';
import { readNativeLegacyOwners } from './nativeLegacyOwners';

type Pass = { pass_key: string; task_key: string; source_id: string; document: DevelopmentNativePassMetadata;
  fingerprint: string; progress: DevelopmentNativePassProgress; state: 'receiving' | 'source-eof' };
async function readPass(db: Executor, taskKey: string, sourceId: string, passKey: string): Promise<OriginalNativePassQualification> {
  const pass = (await db.execute<Pass>(sql`SELECT pass_key,task_key,source_id,document,fingerprint,progress,state
    FROM observability.development_native_passes WHERE pass_key=${passKey} FOR UPDATE`))[0];
  if (!pass || pass.task_key !== taskKey || pass.source_id !== sourceId || jsonHash(pass.document) !== pass.fingerprint)
    throw conflict('原生数值工作未绑定原任务、来源和完整pass');
  const pathsComplete = await readNativePathQualification(db, passKey, pass.document, pass.progress);
  const page = (await db.execute<{ document: DevelopmentNativePageMetadata }>(sql`SELECT document
    FROM observability.development_native_pages WHERE pass_key=${passKey} AND document->'eof' <> 'null'::jsonb`))[0];
  const issue = (await db.execute<{ found: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM observability.development_native_pages
    WHERE pass_key=${passKey} AND jsonb_array_length(document->'issues')>0) AS found`))[0]!;
  return { key: passKey, document: pass.document, progress: pass.progress, state: pass.state,
    pathsComplete, sourceHasIssues: issue.found, eofPage: page?.document ?? null };
}
async function readBefore(db: Executor, taskKey: string, sourceId: string, final: OriginalNativePassQualification) {
  const identity = final.progress.identity;
  const rows = await db.execute<{ pass_key: string }>(sql`SELECT pass_key FROM observability.development_native_passes
    WHERE task_key=${taskKey} AND source_id=${sourceId} AND document->'admission'->'identity'->>'phase'='baseline'
      AND document->'admission'->'identity'->>'turn'=${identity.turn}
      AND document->'admission'->'identity'->>'rootSessionId'=${identity.rootSessionId}
      AND document->'admission'->'identity'->>'epoch'=${identity.epoch}
      AND document->'preparation'=${JSON.stringify(final.document.preparation)}::jsonb
    ORDER BY pass_key LIMIT 2`);
  if (rows.length !== 1) return;
  return readPass(db, taskKey, sourceId, rows[0]!.pass_key);
}
async function pageBinding(db: Executor, passKey: string, ordinal: string) {
  const page = (await db.execute<{ document: DevelopmentNativePageMetadata; complete: boolean; fingerprint: string;
    packet_count: number; received: string }>(sql`SELECT p.document,p.complete,p.fingerprint,p.packet_count,
    (SELECT count(*)::text FROM observability.development_native_packets r WHERE r.pass_key=p.pass_key AND r.ordinal=p.ordinal) AS received
    FROM observability.development_native_pages p WHERE p.pass_key=${passKey} AND p.ordinal=${ordinal}`))[0];
  if (!page || jsonHash(page.document) !== page.fingerprint) throw conflict('原生工作原页元数据不存在或变更');
  const rows = await db.execute<{ original_id: string; document: { sessionId: string; index: number; fingerprint: string } }>(sql`
    SELECT original_id,document FROM observability.development_native_steps
    WHERE pass_key=${passKey} AND document->>'ordinal'=${ordinal} ORDER BY (document->>'index')::integer`);
  return { retained: page.document, packetsComplete: page.complete && BigInt(page.received) === BigInt(page.packet_count),
    references: rows.map(row => ({ stepId: row.original_id, sessionId: row.document.sessionId, index: row.document.index, fingerprint: row.document.fingerprint })) };
}
async function readPath(db: Executor, passKey: string, sessionId: string): Promise<CompleteNativePath | undefined> {
  const row = (await db.execute<{ session_id: string; parent_session_id: string | null; depth: string;
    path_digest: string; source_namespace: string; root: string }>(sql`SELECT p.session_id,p.parent_session_id,p.depth,p.path_digest,p.source_namespace,
    pass.document->'admission'->'identity'->>'rootSessionId' AS root FROM observability.development_native_paths p
    JOIN observability.development_native_passes pass USING(pass_key) WHERE p.pass_key=${passKey} AND p.session_id=${sessionId}`))[0];
  return row ? { root: row.root, session: row.session_id, parentSession: row.parent_session_id,
    depth: row.depth, pathDigest: row.path_digest, sourceNamespace: row.source_namespace } : undefined;
}
async function readOwner(db: Executor, taskKey: string, sourceNamespace: string, sessionId: string, stepId: string) {
  const row = (await db.execute<{ task_key: string; document: NativeStepOwnerReceipt; fingerprint: string }>(sql`
    SELECT task_key,document,fingerprint FROM observability.development_native_owners
    WHERE source_namespace=${sourceNamespace} AND session_id=${sessionId} AND step_id=${stepId} FOR UPDATE`))[0];
  if (!row) return { state: 'missing' as const };
  if (row.task_key !== taskKey || jsonHash(row.document) !== row.fingerprint) return { state: 'ambiguous' as const };
  const usage = (await db.execute<{ document: UsageRecord }>(sql`SELECT document FROM observability.usage_projections
    WHERE meter_key=${jsonHash(row.document.meter)}`))[0]?.document;
  return usage ? { state: 'unique' as const, receipt: row.document, usage } : { state: 'ambiguous' as const };
}
async function verifyOwnerBridge(db: Executor, taskKey: string, sourceId: string, receipt: NativeStepOwnerReceipt,
  prior: NativeStepOwnerReceipt, usage: UsageRecord) {
  const bridge = receipt.bridge;
  if (!bridge) throw conflict('跨 journal 的原 owner 缺少实际 before 引用桥');
  const before = await readPass(db, taskKey, sourceId, bridge.beforePassKey);
  const page = await pageBinding(db, bridge.beforePassKey, bridge.beforeOrdinal);
  const step = page.references.find(row => row.stepId === receipt.stepId);
  if (bridge.previousReceiptFingerprint !== jsonHash(prior) || bridge.previousSequenceKey !== prior.sourceSequenceKey ||
      bridge.previousPassKey !== prior.lastPassKey || bridge.previousWatermark !== prior.lastWatermark ||
      bridge.beforePassKey !== receipt.lastPassKey || !before.pathsComplete || before.sourceHasIssues ||
      before.state !== 'source-eof' || !before.progress.eof || before.progress.identity.phase !== 'baseline' ||
      !page.packetsComplete || page.retained.originalDocumentDigest !== bridge.beforeDocumentDigest ||
      receipt.lastWatermark !== page.retained.ack.sourceWatermark || bridge.beforeIndex !== step?.index ||
      step?.sessionId !== receipt.sessionId || bridge.beforeStepFingerprint !== step.fingerprint ||
      step.fingerprint !== receipt.lastStepFingerprint || bridge.originalProjectionRevision !== usage.projection.projectionRevision ||
      bridge.originalModelRevision !== (usage.projection.modelRevision ?? usage.revision) ||
      receipt.sourceSequenceKey !== jsonHash({ executionId: before.document.key.executionId, journalId: before.document.key.journalId }))
    throw conflict('跨 journal 的原 owner 必须通过同一实际完整 before 引用桥接');
}
async function claimOwner(db: Executor, taskKey: string, sourceId: string, receipt: NativeStepOwnerReceipt, path: CompleteNativePath) {
  const identity = receipt.meter.identity, fingerprint = jsonHash(receipt);
  if (jsonHash({ projectId: identity.projectId, taskId: identity.taskId }) !== taskKey ||
      receipt.sourceNamespace !== path.sourceNamespace || receipt.sessionId !== path.session)
    throw conflict('原生 owner 必须沿用原 meter 的任务与物理父链');
  const pass = (await db.execute<Pass>(sql`SELECT pass_key,task_key,source_id,document,fingerprint,progress,state
    FROM observability.development_native_passes WHERE pass_key=${receipt.lastPassKey}`))[0];
  if (!pass || pass.task_key !== taskKey || pass.source_id !== sourceId ||
      jsonHash(pass.document.registration.identity) !== jsonHash(identity) && receipt.originalPassKey === receipt.lastPassKey)
    throw conflict('原生 owner 的原页来源不属于原任务与受理');
  let prior = await readOwner(db, taskKey, receipt.sourceNamespace, receipt.sessionId, receipt.stepId), inserted = false;
  if (prior.state === 'missing') {
    inserted = (await db.execute<{ meter_key: string }>(sql`INSERT INTO observability.development_native_owners
      (source_namespace,session_id,step_id,task_key,project_id,task_id,meter_key,document,fingerprint)
      VALUES(${receipt.sourceNamespace},${receipt.sessionId},${receipt.stepId},${taskKey},${identity.projectId},${identity.taskId},
        ${jsonHash(receipt.meter)},${JSON.stringify(receipt)}::jsonb,${fingerprint}) ON CONFLICT DO NOTHING RETURNING meter_key`)).length > 0;
    prior = await readOwner(db, taskKey, receipt.sourceNamespace, receipt.sessionId, receipt.stepId);
  }
  if (prior.state !== 'unique' || !prior.receipt || jsonHash(prior.receipt.meter) !== jsonHash(receipt.meter) ||
      prior.receipt.originalPassKey !== receipt.originalPassKey)
    throw conflict('同一物理步骤已有不一致的原执行归属');
  if (prior.receipt.sourceSequenceKey !== receipt.sourceSequenceKey) {
    await verifyOwnerBridge(db, taskKey, sourceId, receipt, prior.receipt, prior.usage!);
  } else if (BigInt(prior.receipt.lastWatermark) > BigInt(receipt.lastWatermark))
    throw conflict('原生 owner 不能倒退同一原 journal 的受理水位');
  if (prior.receipt.sourceSequenceKey === receipt.sourceSequenceKey && prior.receipt.lastWatermark === receipt.lastWatermark && prior.receipt.lastStepFingerprint !== receipt.lastStepFingerprint)

    throw conflict('原生 owner 同一原水位的步骤内容冲突');
  if (jsonHash(prior.receipt) === fingerprint) return inserted;
  await db.execute(sql`UPDATE observability.development_native_owners SET document=${JSON.stringify(receipt)}::jsonb,
    fingerprint=${fingerprint} WHERE source_namespace=${receipt.sourceNamespace} AND session_id=${receipt.sessionId} AND step_id=${receipt.stepId}`);
  return true;
}
async function readWork(db: Executor, passKey: string): Promise<NativeDevelopmentWork> {
  const retained = (await db.execute<{ document: NativeDevelopmentWork }>(sql`SELECT document
    FROM observability.development_native_work WHERE pass_key=${passKey} FOR UPDATE`))[0]?.document;
  return retained ?? { passKey, ordinal: '0', index: 0, visited: '0', held: '0', issues: [], numericEof: false, valuationEof: false };
}
async function commitWork(db: Executor, taskKey: string, sourceId: string, work: NativeDevelopmentWork, processed: boolean) {
  const pass = await readPass(db, taskKey, sourceId, work.passKey), identity = pass.document.registration.identity;
  if (![work.ordinal, work.visited, work.held].every(value => /^(0|[1-9][0-9]*)$/.test(value)) ||
      !Number.isSafeInteger(work.index) || work.index < 0 || work.index > 1000 || BigInt(work.held) > BigInt(work.visited) ||
      work.numericEof && (work.visited !== pass.progress.counts.steps || work.ordinal !== pass.progress.ordinal || work.index !== 0) ||
      processed && (!work.numericEof || !work.valuationEof || work.held !== '0'))
    throw conflict('原生工作进度必须核对全部原步骤 EOF 与估值完成');
  const changed = await db.execute(sql`INSERT INTO observability.development_native_work(pass_key,task_key,project_id,task_id,source_id,document)
    VALUES(${work.passKey},${taskKey},${identity.projectId},${identity.taskId},${sourceId},${JSON.stringify(work)}::jsonb)
    ON CONFLICT(pass_key) DO UPDATE SET document=EXCLUDED.document
    WHERE development_native_work.document IS DISTINCT FROM EXCLUDED.document RETURNING pass_key`);
  const progressChanged = await db.execute(sql`UPDATE observability.development_native_passes SET work_state=${processed ? 'processed' : 'pending'},
    work_cursor=${JSON.stringify({ ordinal: work.ordinal, index: work.index })} WHERE pass_key=${work.passKey}
    AND (work_state<>${processed ? 'processed' : 'pending'} OR work_cursor IS DISTINCT FROM ${JSON.stringify({ ordinal: work.ordinal, index: work.index })}) RETURNING pass_key`);
  // Report metadata advances the existing clock without altering the dependency used by held-work retries.
  if (changed.length || progressChanged.length) await db.execute(sql`INSERT INTO observability.runtime_report_revisions DEFAULT VALUES`);
}
/** Called only inside the original task-head transaction. */
export function nativeDevelopmentTransaction(db: Executor, taskKey: string, sourceId: string,
  original: DevelopmentUsageTransaction, dependencies: { value(): Promise<string>; changed(): void }): NativeDevelopmentTransaction {
  return { ...original, nativeDependencyVersion: dependencies.value,
    nativePendingValue: async passKey => {
      const pass = await readPass(db, taskKey, sourceId, passKey), identity = pass.document.registration.identity;
      return (await pendingNativeDevelopmentValues(db)({ projectId: identity.projectId, taskId: identity.taskId }, passKey, 1)).length > 0;
    },
    nativePass: key => readPass(db, taskKey, sourceId, key), nativeBefore: final => readBefore(db, taskKey, sourceId, final),
    nativePageBinding: (key, ordinal) => pageBinding(db, key, ordinal),
    nativeStepReference: async (key, stepId) => (await db.execute<{ ordinal: string; index: number; fingerprint: string }>(sql`
      SELECT document->>'ordinal' AS ordinal,(document->>'index')::integer AS index,document->>'fingerprint' AS fingerprint
      FROM observability.development_native_steps WHERE pass_key=${key} AND original_id=${stepId}`))[0],
    nativePath: (key, session) => readPath(db, key, session),
    nativeOwner: (namespace, session, step) => readOwner(db, taskKey, namespace, session, step),
    nativeEarlierOwner: async (namespace, finalKey) => (await db.execute<{ found: boolean }>(sql`SELECT EXISTS(
      SELECT 1 FROM observability.development_native_owners WHERE source_namespace=${namespace}
        AND document->>'originalPassKey'<>${finalKey}) AS found`))[0]!.found,
    nativeLegacyOwners: (path, before) => readNativeLegacyOwners(db, taskKey, path, before),
    nativeClaim: async (receipt, path) => { if (await claimOwner(db, taskKey, sourceId, receipt, path)) dependencies.changed(); },
    nativeReference: reference => persistNativeReference(db, taskKey, reference),
    nativeOriginalModel: (ref, revision) => readDevelopmentModel(db, ref, revision),
    nativeWork: key => readWork(db, key), nativeWorkCommit: (work, processed) => commitWork(db, taskKey, sourceId, work, processed),
  };
}
export const pendingNativeDevelopment = (db: Executor): NativeDevelopmentLedgerStore['pendingNativeDevelopment'] => async (after, pageSize, filter) => {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new RangeError('Invalid native pass scheduling page');
  const rows = await db.execute<{ pass_key: string; source_id: string; document: DevelopmentNativePassMetadata }>(sql`
    SELECT pass_key,source_id,document FROM observability.development_native_passes pass WHERE (work_state='pending'
      OR NOT EXISTS(SELECT 1 FROM observability.development_native_work work WHERE work.pass_key=pass.pass_key AND work.document ? 'baselineState'))
      ${filter ? sql`AND task_key=${jsonHash(filter.scope)} AND source_id=${filter.sourceId}` : sql``}
      ${after === null ? sql`` : sql`AND pass_key>${after}`} ORDER BY pass_key LIMIT ${pageSize + 1}`);
  const items = rows.slice(0, pageSize);
  return { items: items.map(row => ({ passKey: row.pass_key, sourceId: row.source_id, scope: {
    projectId: row.document.registration.identity.projectId, taskId: row.document.registration.identity.taskId,
  } })), nextCursor: rows.length > pageSize ? items.at(-1)!.pass_key : null };
};
export const pendingNativeDevelopmentValues = (db: Executor): NativeDevelopmentLedgerStore['pendingNativeDevelopmentValues'] => async (scope, passKey, pageSize) => {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) throw new RangeError('Invalid native valuation scheduling page');
  const taskKey = jsonHash({ projectId: scope.projectId, taskId: scope.taskId });
  const rows = await db.execute<{ meter: NativeStepOwnerReceipt['meter'] }>(sql`SELECT owner.document->'meter' AS meter
    FROM observability.development_native_owners owner JOIN observability.usage_projections usage ON usage.meter_key=owner.meter_key
    LEFT JOIN observability.native_repairs repair ON repair.meter_key=owner.meter_key
    LEFT JOIN observability.execution_valuations value ON value.meter_key=repair.valuation_key
    WHERE owner.task_key=${taskKey} AND owner.document->>'lastPassKey'=${passKey}
      AND value.document->>'usageRevision' IS DISTINCT FROM usage.document->'projection'->>'projectionRevision'
    ORDER BY owner.meter_key LIMIT ${pageSize}`);
  return rows.map(row => row.meter);
};
