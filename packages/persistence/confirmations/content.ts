import { sql } from 'drizzle-orm';
import type { Executor } from '../connection';

export interface ContentConfirmation {
  readonly context: string; readonly key: string; readonly source: string; readonly evidence: string; readonly decision: string;
  readonly actor: string; readonly at: string; readonly value: unknown;
}
const table = (schema: string) => {
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error('Invalid confirmation schema');
  return sql`${sql.identifier(schema)}.${sql.identifier('operator_confirmations')}`;
};
/** Owner-scoped immutable decisions. No inferred ownership, cross-schema relationship, or original-history update. */
export async function readContentConfirmation(db: Executor, schema: string, input: Pick<ContentConfirmation, 'context' | 'key' | 'source' | 'evidence'>): Promise<ContentConfirmation | undefined> {
  const rows = await db.execute<{ decision: string; actor_id: string; confirmed_at: string; value: unknown }>(sql`SELECT decision,actor_id,confirmed_at::text,value FROM ${table(schema)}
    WHERE context_id=${input.context} AND item_key=${input.key} AND source_digest=${input.source} AND evidence_digest=${input.evidence} ORDER BY confirmed_at DESC LIMIT 1`);
  const row = rows[0];
  return row ? { ...input, decision: row.decision, actor: row.actor_id, at: new Date(row.confirmed_at).toISOString(), value: row.value } : undefined;
}
export async function appendContentConfirmation(db: Executor, schema: string, input: ContentConfirmation): Promise<ContentConfirmation> {
  await db.execute(sql`SELECT set_config('crewstation.operator_confirmation',${[input.context, input.source, input.evidence, input.decision, input.actor].join(':')},true)`);
  await db.execute(sql`INSERT INTO ${table(schema)}(context_id,item_key,source_digest,evidence_digest,decision,actor_id,confirmed_at,value)
    VALUES(${input.context},${input.key},${input.source},${input.evidence},${input.decision},${input.actor},${input.at}::timestamptz,${JSON.stringify(input.value)}::text::jsonb) ON CONFLICT DO NOTHING`);
  const saved = await readContentConfirmation(db, schema, input);
  if (!saved || saved.decision !== input.decision) throw new Error('A different decision already exists for this unchanged source');
  return saved;
}
