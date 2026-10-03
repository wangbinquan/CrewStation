import { precondition } from '@crewstation/kernel';
import type { Database, Executor, Transaction } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';

export interface EventContentIdentity { readonly id: string; readonly birthDigest: string; readonly contentDigest: string }
/** Internal origins only. Trace text and dead-letter error bodies remain inside their digests. */
export interface EventContentItem extends EventContentIdentity {
  readonly topic: string; readonly payload: unknown; readonly legacyPayload: unknown; readonly identityProvenance: unknown;
  readonly deadLetters: number;
}
const shapes = {
  domain_events: ['id','topic','payload','trace_id','occurred_at','created_at','legacy_payload','identity_provenance'].sort(),
  event_dead_letters: ['consumer','event_id','error','created_at'].sort(),
};
const validId = (value: string) => typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && BigInt(value) <= 9223372036854775807n;
const digest = (body: ReturnType<typeof sql>) => sql`encode(sha256(convert_to((${body})::text,'UTF8')),'hex')`;
/** SQL alias `e` identifies the locked original row, including its legacy provenance. */
export const eventBirthDigest = () => digest(sql`to_jsonb(e)`);
const content = () => digest(sql`jsonb_build_object('event',to_jsonb(e),'deadLetters',COALESCE(
  (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.consumer) FROM platform_infra.event_dead_letters d WHERE d.event_id=e.id),'[]'::jsonb))`);
async function assertShape(executor: Executor) {
  for (const [table, expected] of Object.entries(shapes)) {
    const rows = await executor.execute<{ column_name: string }>(sql`SELECT column_name FROM information_schema.columns
      WHERE table_schema='platform_infra' AND table_name=${table} ORDER BY column_name`);
    if (JSON.stringify(rows.map((row) => row.column_name)) !== JSON.stringify(expected)) throw precondition('Event content columns are unknown');
  }
}
function assertOrigins(origins: readonly EventContentIdentity[]) {
  if (origins.length > 200 || new Set(origins.map((item) => item.id)).size !== origins.length || origins.some((item) =>
    !validId(item.id) || !/^[a-f0-9]{64}$/.test(item.birthDigest) || !/^[a-f0-9]{64}$/.test(item.contentDigest))) throw precondition('Invalid event content origins');
}

/** Every page includes the entire dead-letter digest; global consumer cursors are deliberately outside content removal. */
export async function readEventContents(executor: Executor, after: string | null = null, limit = 200): Promise<readonly EventContentItem[]> {
  if (after !== null && !validId(after) || !Number.isInteger(limit) || limit < 1 || limit > 200) throw precondition('Invalid event content cursor');
  await assertShape(executor);
  const rows = await executor.execute<{ id: string; topic: string; payload: unknown; legacy_payload: unknown; identity_provenance: unknown;
    dead_letters: number; birth_digest: string; content_digest: string }>(sql`
    SELECT e.id::text AS id,e.topic,e.payload,e.legacy_payload,e.identity_provenance,
      (SELECT count(*)::integer FROM platform_infra.event_dead_letters d WHERE d.event_id=e.id) AS dead_letters,
      ${eventBirthDigest()} AS birth_digest,${content()} AS content_digest FROM platform_infra.domain_events e
    WHERE (${after}::bigint IS NULL OR e.id>${after}::bigint) ORDER BY e.id LIMIT ${limit}`);
  return rows.map((row) => ({ id: row.id,topic: row.topic,payload: row.payload,legacyPayload: row.legacy_payload,identityProvenance: row.identity_provenance,
    deadLetters: row.dead_letters,
    birthDigest: row.birth_digest,contentDigest: row.content_digest }));
}

/** Historical errors without an event have no recoverable payload origin; callers must report them instead of overlooking them. */
export async function readOrphanEventDeadLetters(executor: Executor, after: { readonly eventId: string; readonly consumer: string } | null = null, limit = 200) {
  if (after && (!validId(after.eventId) || typeof after.consumer !== 'string') || !Number.isInteger(limit) || limit < 1 || limit > 200) throw precondition('Invalid orphan error cursor');
  await assertShape(executor);
  return executor.execute<{ event_id: string; consumer: string; digest: string }>(sql`
    SELECT d.event_id::text AS event_id,d.consumer,${digest(sql`to_jsonb(d)`)} AS digest FROM platform_infra.event_dead_letters d
    WHERE NOT EXISTS(SELECT 1 FROM platform_infra.domain_events e WHERE e.id=d.event_id)
      AND (${after?.eventId ?? null}::bigint IS NULL OR d.event_id>${after?.eventId ?? null}::bigint
        OR d.event_id=${after?.eventId ?? null}::bigint AND d.consumer COLLATE "C">${after?.consumer ?? null})
    ORDER BY d.event_id,d.consumer COLLATE "C" LIMIT ${limit}`);
}

/** Must replace the consumer's old blind insert before removal is enabled. Missing/replaced originals cannot acquire a late error. */
export async function writeEventDeadLetter(tx: Transaction, original: Pick<EventContentIdentity, 'id' | 'birthDigest'>, consumer: string, error: string): Promise<boolean> {
  if (!validId(original.id) || !/^[a-f0-9]{64}$/.test(original.birthDigest) || !consumer) throw precondition('Invalid original dead letter');
  const rows = await tx.execute(sql`WITH original AS MATERIALIZED(SELECT e.id FROM platform_infra.domain_events e
    WHERE e.id=${original.id}::bigint AND ${eventBirthDigest()}=${original.birthDigest} FOR KEY SHARE OF e)
    INSERT INTO platform_infra.event_dead_letters(consumer,event_id,error)
    SELECT ${consumer},id,${error} FROM original ON CONFLICT DO NOTHING RETURNING event_id`);
  return rows.length === 1;
}

/** Transaction-owned locks precede a fresh snapshot, so an error committed while waiting cannot escape the confirmed digest. */
export async function removeEventContents(db: Database, identities: readonly EventContentIdentity[]): Promise<{ readonly stable: boolean; readonly removed: number }> {
  return db.transaction((tx) => removeEventContentsInTransaction(tx, identities));
}

/** The caller owns the actual transaction, allowing content removal and the final domain receipt to commit together. */
export async function removeEventContentsInTransaction(tx: Transaction, identities: readonly EventContentIdentity[]): Promise<{ readonly stable: boolean; readonly removed: number }> {
  assertOrigins(identities);
    await assertShape(tx);
    if (!identities.length) return { stable: true,removed: 0 };
    const origins = identities.map(({ id,birthDigest,contentDigest }) => ({ id,birthDigest,contentDigest }));
    const ids = origins.map((row) => row.id);
    await tx.execute(sql`SELECT e.id FROM platform_infra.domain_events e
      WHERE e.id IN(SELECT value::bigint FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)) ORDER BY e.id FOR UPDATE OF e`);
    await tx.execute(sql`SELECT d.event_id,d.consumer FROM platform_infra.event_dead_letters d
      WHERE d.event_id IN(SELECT value::bigint FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)) ORDER BY d.event_id,d.consumer FOR UPDATE OF d`);
    const rows = await tx.execute<{ stable: boolean }>(sql`WITH requested AS(
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(origins)}::jsonb) AS r(id text,"birthDigest" text,"contentDigest" text))
      SELECT NOT EXISTS(SELECT 1 FROM requested r LEFT JOIN platform_infra.domain_events e ON e.id=r.id::bigint
        WHERE CASE WHEN e.id IS NULL THEN EXISTS(SELECT 1 FROM platform_infra.event_dead_letters d WHERE d.event_id=r.id::bigint)
          ELSE ${eventBirthDigest()} IS DISTINCT FROM r."birthDigest" OR ${content()} IS DISTINCT FROM r."contentDigest" END) AS stable`);
    if (rows[0]?.stable !== true) return { stable: false,removed: 0 };
    await tx.execute(sql`DELETE FROM platform_infra.event_dead_letters WHERE event_id IN(
      SELECT value::bigint FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`);
    const removed = await tx.execute(sql`DELETE FROM platform_infra.domain_events WHERE id IN(
      SELECT value::bigint FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)) RETURNING id`);
    return { stable: true,removed: removed.length };
}
