import { precondition } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';

export interface QueueContentIdentity { readonly id: string; readonly birthDigest: string; readonly contentDigest: string }
/** Payloads are for internal ownership classification. Error text and lease credentials are never returned. */
export interface QueueContentItem extends QueueContentIdentity {
  readonly kind: string; readonly payload: unknown; readonly legacyPayload: unknown; readonly identityProvenance: unknown;
  readonly dedupKey: string | null; readonly state: string;
}
const columns = ['id', 'kind', 'payload', 'state', 'run_at', 'lease_until', 'lease_owner', 'fencing_token', 'attempts',
  'max_attempts', 'last_error', 'dedup_key', 'created_at', 'updated_at', 'legacy_payload', 'identity_provenance'].sort();
const validId = (value: string) => typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && BigInt(value) <= 9223372036854775807n;
const digest = (body: ReturnType<typeof sql>) => sql`encode(sha256(convert_to((${body})::text,'UTF8')),'hex')`;
const birth = () => digest(sql`jsonb_build_object('id',j.id,'kind',j.kind,'payload',j.payload,'legacy',j.legacy_payload,
  'provenance',j.identity_provenance,'dedup',j.dedup_key,'createdAt',j.created_at)`);
const content = () => digest(sql`to_jsonb(j)`);
async function assertShape(executor: Executor) {
  const rows = await executor.execute<{ column_name: string }>(sql`SELECT column_name FROM information_schema.columns
    WHERE table_schema='platform_infra' AND table_name='jobs' ORDER BY column_name`);
  if (JSON.stringify(rows.map((row) => row.column_name)) !== JSON.stringify(columns)) throw precondition('Queue content columns are unknown');
}

/** Keyset scan retains bigint IDs exactly; the caller must finish every page and classify every returned origin. */
export async function readQueueContents(executor: Executor, after: string | null = null, limit = 200, kind?: string): Promise<readonly QueueContentItem[]> {
  if (after !== null && !validId(after) || !Number.isInteger(limit) || limit < 1 || limit > 200) throw precondition('Invalid queue content cursor');
  if (kind !== undefined && (typeof kind !== 'string' || !kind.length || kind.length > 200)) throw precondition('Invalid queue content kind');
  await assertShape(executor);
  const rows = await executor.execute<{ id: string; kind: string; payload: unknown; legacy_payload: unknown; identity_provenance: unknown;
    dedup_key: string | null; state: string; birth_digest: string; content_digest: string }>(sql`
    SELECT j.id::text AS id,j.kind,j.payload,j.legacy_payload,j.identity_provenance,j.dedup_key,j.state,
      ${birth()} AS birth_digest,${content()} AS content_digest FROM platform_infra.jobs j
    WHERE (${after}::bigint IS NULL OR j.id>${after}::bigint) AND (${kind ?? null}::text IS NULL OR j.kind=${kind ?? null}) ORDER BY j.id LIMIT ${limit}`);
  return rows.map((row) => {
    if (!validId(row.id)) throw precondition('Queue content original ID is unknown');
    return { id: row.id, kind: row.kind, payload: row.payload, legacyPayload: row.legacy_payload, identityProvenance: row.identity_provenance,
      dedupKey: row.dedup_key, state: row.state, birthDigest: row.birth_digest, contentDigest: row.content_digest };
  });
}

/** Read-only substring guard over the entire unchanged row, including private errors and lease fields. No private text leaves this package. */
export async function queueContentContains(executor: Executor, original: QueueContentIdentity, fragments: readonly string[]): Promise<boolean> {
  if (!validId(original.id) || !/^[a-f0-9]{64}$/.test(original.birthDigest) || !/^[a-f0-9]{64}$/.test(original.contentDigest) || fragments.length > 200 || fragments.some(value => typeof value !== 'string' || !value.length)) throw precondition('Invalid queue content guard');
  await assertShape(executor);
  const [row] = await executor.execute<{ stable: boolean; matched: boolean }>(sql`SELECT ${birth()}=${original.birthDigest} AND ${content()}=${original.contentDigest} AS stable,
    EXISTS(SELECT 1 FROM jsonb_array_elements_text(${JSON.stringify(fragments)}::jsonb) value WHERE strpos(to_jsonb(j)::text,value)>0) AS matched
    FROM platform_infra.jobs j WHERE id=${original.id}::bigint`);
  if (row?.stable !== true || typeof row.matched !== 'boolean') throw precondition('Queue content changed during guard');
  return row.matched;
}

/** Only confirmed row identities are accepted. One statement locks, rechecks and deletes all-or-none; absence permits replay. */
export async function removeQueueContents(executor: Executor, identities: readonly QueueContentIdentity[]): Promise<{ readonly stable: boolean; readonly removed: number }> {
  if (identities.length > 200 || new Set(identities.map((item) => item.id)).size !== identities.length || identities.some((item) =>
    !validId(item.id) || !/^[a-f0-9]{64}$/.test(item.birthDigest) || !/^[a-f0-9]{64}$/.test(item.contentDigest))) throw precondition('Invalid queue content origins');
  await assertShape(executor);
  if (!identities.length) return { stable: true, removed: 0 };
  const origins = identities.map(({ id, birthDigest, contentDigest }) => ({ id, birthDigest, contentDigest }));
  const rows = await executor.execute<{ stable: boolean; removed: number }>(sql`
    WITH requested AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(origins)}::jsonb) AS r(id text,"birthDigest" text,"contentDigest" text)),
    locked AS MATERIALIZED(SELECT j.id,${birth()}=r."birthDigest" AND ${content()}=r."contentDigest" AS stable
      FROM platform_infra.jobs j JOIN requested r ON j.id=r.id::bigint ORDER BY j.id FOR UPDATE OF j),
    checked AS (SELECT COALESCE(bool_and(stable),true) AS stable FROM locked),
    removed AS (DELETE FROM platform_infra.jobs j USING locked,checked WHERE checked.stable AND j.id=locked.id RETURNING j.id)
    SELECT checked.stable,(SELECT count(*)::integer FROM removed) AS removed FROM checked`);
  const result = rows[0];
  if (!result || typeof result.stable !== 'boolean' || !Number.isInteger(result.removed)) throw precondition('Queue content removal did not return a complete result');
  return result;
}
