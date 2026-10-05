import { and, asc, eq, sql } from 'drizzle-orm';
import { DevelopmentNativePageEvidenceSchema, type DevelopmentNativePageEvidence, type DevelopmentUsageEvent, type DevelopmentUsageKey, type DevelopmentUsageRegistration, type TaskId } from '@crewstation/contracts';
import { conflict, jsonHash, validation } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { assertOriginalNativePacket } from '../../domain/developmentNativeEvidence';
import type { SessionOriginalTaskStorage } from '../../ports/projectDeletion';
import type { DevelopmentUsageStore } from '../../ports/developmentUsage';
import { locked } from './developmentUsageState';
import { sessionStorageKey } from './deletion/taskStorage';
import { DevelopmentUsageKeySchema } from '@crewstation/contracts';
import { developmentUsageEvents as events } from './developmentUsageTables';

export async function copyNativeEvidence(tx: Executor, taskId: TaskId, registration: DevelopmentUsageRegistration,
  copies: DevelopmentNativePageEvidence[]): Promise<void> {
  for (const raw of copies) {
    const evidence = DevelopmentNativePageEvidenceSchema.parse(raw), ack = evidence.ack;
    if (jsonHash(evidence.key) !== jsonHash(registration.key) || evidence.podUid !== registration.podUid)
      throw conflict('原页副本不属于原开发执行');
    const rows = await tx.select().from(events).where(and(eq(events.taskId, taskId),
      sql`${events.event}->'capture'->>'version'='2'`,
      sql`${events.event}->'capture'->'nativeSource'->'ack'->'identity'->>'passId'=${ack.identity.passId}`,
      sql`${events.event}->'capture'->'nativeSource'->'ack'->>'ordinal'=${ack.ordinal}`)).orderBy(asc(events.sequence));
    const anchor = rows.find((row) => row.event.capture.version === 2 && row.event.capture.nativeSource.packetIndex === 0);
    if (!anchor) throw conflict('原页副本必须保存到原首个数字帧');
    for (const row of rows) assertOriginalNativePacket(evidence, row.event);
    if (anchor.event.nativeEvidence) {
      if (jsonHash(anchor.event.nativeEvidence) !== jsonHash(evidence)) throw conflict('原页持久副本不能替换');
    } else await tx.update(events).set({ event: { ...anchor.event, nativeEvidence: evidence } })
      .where(and(eq(events.taskId, taskId), eq(events.sequence, anchor.sequence)));
  }
}
/** Query the entire committed range. LIMIT 1 is only an existence witness, never a statistics cap. */
export async function hasMissingNativeCopy(tx: Executor, taskId: TaskId, through: number): Promise<boolean> {
  const rows = await tx.execute(sql`SELECT 1 FROM session.development_usage_events e
    LEFT JOIN session.development_usage_events a ON a.task_id=e.task_id
      AND a.sequence=(e.event->'capture'->'nativeSource'->>'sequenceFrom')::bigint
    WHERE e.task_id=${taskId} AND e.sequence<=${through} AND e.event->'capture'->>'version'='2'
      AND (a.event->'nativeEvidence' IS NULL OR
        a.event->'nativeEvidence'->'ack' IS DISTINCT FROM e.event->'capture'->'nativeSource'->'ack') LIMIT 1`);
  return rows.length > 0;
}
export async function retainedNativePage(tx: Executor, taskId: string, key: DevelopmentUsageKey,
  passId: string, ordinal: string): Promise<DevelopmentNativePageEvidence | undefined> {
  if (!passId || passId.length > 512 || !/^(0|[1-9][0-9]*)$/.test(ordinal)) throw validation('原生页地址无效');
  const rows = await tx.select({ event: events.event }).from(events).where(and(eq(events.taskId, taskId),
    sql`${events.event}->'nativeEvidence'->'ack'->'identity'->>'passId'=${passId}`,
    sql`${events.event}->'nativeEvidence'->'ack'->>'ordinal'=${ordinal}`));
  if (rows.length > 1) throw conflict('原生页出现多个不同原首帧副本');
  const evidence = rows[0]?.event.nativeEvidence;
  if (!evidence) return undefined;
  if (jsonHash(evidence.key) !== jsonHash(key)) throw conflict('原生页副本与原日志键不同');
  assertOriginalNativePacket(evidence, rows[0]!.event);
  return DevelopmentNativePageEvidenceSchema.parse(evidence);
}
export const publicDevelopmentEvent = (value: DevelopmentUsageEvent & { nativeEvidence?: DevelopmentNativePageEvidence }): DevelopmentUsageEvent => {
  const { nativeEvidence: _nativeEvidence, ...event } = value; return event;
};

export function nativeCopyControls(db: Database, storage?: SessionOriginalTaskStorage): Pick<DevelopmentUsageStore, 'verifyRunnerCopy' | 'nativePage'> {
  return {
    verifyRunnerCopy: (taskId, rawKey, through) => db.transaction(async (tx) => {
      const row = await locked(tx, taskId, DevelopmentUsageKeySchema.parse(rawKey));
      if (!Number.isSafeInteger(through) || through < 0 || through > row.persistedThrough || await hasMissingNativeCopy(tx, taskId, through))
        throw conflict('不能确认尚未完整保存原页的开发数字');
    }),
    nativePage: (rawKey, passId, ordinal) => db.transaction(async (tx) => {
      const key = DevelopmentUsageKeySchema.parse(rawKey); await locked(tx, key.executionId, key, storage);
      return retainedNativePage(tx, sessionStorageKey(key.executionId, storage), key, passId, ordinal);
    }),
  };
}
