import { conflict, jsonHash } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { DevelopmentNativePacket } from '../../../domain/developmentUsage/packet';
import { developmentNativeMetadata, developmentNativeReferences, type DevelopmentNativePassMetadata } from '../../../domain/developmentUsage/metadata';
import { advanceDevelopmentNativeProgress, initialDevelopmentNativeProgress, type DevelopmentNativePassProgress } from '../../../domain/developmentUsage/progress';

type Metadata = ReturnType<typeof developmentNativeMetadata>;
type PassRow = {
  pass_key: string; document: DevelopmentNativePassMetadata; fingerprint: string;
  progress: DevelopmentNativePassProgress; state: 'receiving' | 'source-eof'; work_state: 'pending' | 'processed';
};
const table = (name: string) => sql`${sql.identifier('observability')}.${sql.identifier(name)}`;

async function retainPass(db: Executor, packet: DevelopmentNativePacket, meta: Metadata): Promise<PassRow> {
  const initial = initialDevelopmentNativeProgress(packet);
  await db.execute(sql`INSERT INTO observability.development_native_passes
    (pass_key,task_key,project_id,task_id,source_id,document,fingerprint,progress,state,work_state)
    VALUES(${meta.passKey},${meta.taskKey},${meta.projectId},${meta.taskId},${packet.streamSourceId},
      ${JSON.stringify(meta.pass)}::jsonb,${meta.passFingerprint},${JSON.stringify(initial)}::jsonb,'receiving','pending')
    ON CONFLICT(pass_key) DO NOTHING`);
  const row = (await db.execute<PassRow>(sql`SELECT pass_key,document,fingerprint,progress,state,work_state
    FROM observability.development_native_passes WHERE pass_key=${meta.passKey} FOR UPDATE`))[0]!;
  if (row.fingerprint !== meta.passFingerprint || jsonHash(row.document) !== meta.passFingerprint)
    throw conflict('原生 pass 的独立登记、原准入或原来源不能变化');
  return row;
}
async function retainPage(db: Executor, meta: Metadata): Promise<boolean> {
  const inserted = await db.execute(sql`INSERT INTO observability.development_native_pages
    (pass_key,ordinal,task_key,project_id,task_id,document,fingerprint,packet_count,complete)
    VALUES(${meta.passKey},${meta.page.ordinal},${meta.taskKey},${meta.projectId},${meta.taskId},
      ${JSON.stringify(meta.page)}::jsonb,${meta.pageFingerprint},${meta.page.packetCount},false)
    ON CONFLICT(pass_key,ordinal) DO NOTHING RETURNING ordinal`);
  const row = (await db.execute<{ fingerprint: string; document: Metadata['page'] }>(sql`SELECT fingerprint,document
    FROM observability.development_native_pages WHERE pass_key=${meta.passKey} AND ordinal=${meta.page.ordinal}`))[0]!;
  if (row.fingerprint !== meta.pageFingerprint || jsonHash(row.document) !== meta.pageFingerprint)
    throw conflict('原生同一原页的摘要、ACK或处理绑定变化');
  return inserted.length > 0;
}
async function retainReferences(db: Executor, packet: DevelopmentNativePacket, meta: Metadata): Promise<void> {
  const refs = developmentNativeReferences(packet);
  for (const [name, values] of [['development_native_sessions', refs.sessions], ['development_native_steps', refs.steps]] as const) {
    if (!values.length) continue;
    const entries = values.map((row) => sql`(${meta.passKey},${row.id},${meta.taskKey},${meta.projectId},${meta.taskId},
      ${JSON.stringify(row)}::jsonb,${jsonHash(row)})`);
    await db.execute(sql`INSERT INTO ${table(name)}(pass_key,original_id,task_key,project_id,task_id,document,fingerprint)
      VALUES ${sql.join(entries, sql`, `)} ON CONFLICT(pass_key,original_id) DO NOTHING`);
    const rows = await db.execute<{ original_id: string; fingerprint: string; document: unknown }>(sql`SELECT original_id,fingerprint,document
      FROM ${table(name)} WHERE pass_key=${meta.passKey} AND original_id IN (${sql.join(values.map((row) => sql`${row.id}`), sql`, `)})`);
    const expected = new Map(values.map((row) => [row.id, jsonHash(row)]));
    if (rows.length !== values.length || rows.some((row) => expected.get(row.original_id) !== row.fingerprint || jsonHash(row.document) !== row.fingerprint))
      throw conflict('原生 session或step的原父关系、原页位置发生冲突');
  }
}
async function retainPacket(db: Executor, packet: DevelopmentNativePacket, meta: Metadata): Promise<boolean> {
  const inserted = await db.execute(sql`INSERT INTO observability.development_native_packets
    (pass_key,ordinal,packet_index,task_key,project_id,task_id,source_id,sequence,fingerprint)
    VALUES(${meta.passKey},${meta.page.ordinal},${packet.packetIndex},${meta.taskKey},${meta.projectId},${meta.taskId},
      ${packet.streamSourceId},${String(packet.event.sequence)},${packet.fingerprint})
    ON CONFLICT(pass_key,ordinal,packet_index) DO NOTHING RETURNING packet_index`);
  const row = (await db.execute<{ fingerprint: string }>(sql`SELECT fingerprint FROM observability.development_native_packets
    WHERE pass_key=${meta.passKey} AND ordinal=${meta.page.ordinal} AND packet_index=${packet.packetIndex}`))[0]!;
  if (row.fingerprint !== packet.fingerprint) throw conflict('原生同一packet的原帧内容变化');
  return inserted.length === 0;
}
async function qualifyEofPopulation(db: Executor, meta: Metadata, progress: DevelopmentNativePassProgress): Promise<void> {
  if (!progress.eof) return;
  const count = async (name: string) => (await db.execute<{ total: string }>(sql`SELECT count(*)::text AS total
    FROM ${table(name)} WHERE pass_key=${meta.passKey}`))[0]!.total;
  const [sessions, steps, pages] = await Promise.all([count('development_native_sessions'), count('development_native_steps'), count('development_native_pages')]);
  const incomplete = (await db.execute<{ total: string }>(sql`SELECT count(*)::text AS total FROM observability.development_native_pages
    WHERE pass_key=${meta.passKey} AND NOT complete`))[0]!.total;
  if (sessions !== progress.counts.sessions || steps !== progress.counts.steps || pages !== progress.ordinal || incomplete !== '0')
    throw conflict('原生实际保留的完整人口与原 EOF 不符');
}
/** Must run inside the existing changeDevelopment transaction, before ordinary source ACK. */
export async function retainDevelopmentNativePacket(db: Executor, taskKey: string, sourceId: string, packet: DevelopmentNativePacket) {
  const meta = developmentNativeMetadata(packet);
  if (meta.taskKey !== taskKey || packet.streamSourceId !== sourceId) throw conflict('原生packet必须属于当前原用量事务的同一任务与来源');
  const pass = await retainPass(db, packet, meta);
  if (BigInt(packet.page.ordinal) > BigInt(pass.progress.ordinal)) throw conflict('原生完整人口仍等待前一原页的全部packet');
  if (await retainPage(db, meta)) await retainReferences(db, packet, meta);
  const duplicate = await retainPacket(db, packet, meta);
  const page = (await db.execute<{ complete: boolean; received: string }>(sql`SELECT p.complete,
    (SELECT count(*)::text FROM observability.development_native_packets r WHERE r.pass_key=p.pass_key AND r.ordinal=p.ordinal) AS received
    FROM observability.development_native_pages p WHERE p.pass_key=${meta.passKey} AND p.ordinal=${meta.page.ordinal}`))[0]!;
  if (!page.complete && BigInt(page.received) === BigInt(packet.packetCount)) {
    const progress = advanceDevelopmentNativeProgress(pass.progress, packet);
    await db.execute(sql`UPDATE observability.development_native_pages SET complete=true WHERE pass_key=${meta.passKey} AND ordinal=${meta.page.ordinal}`);
    await qualifyEofPopulation(db, meta, progress);
    await db.execute(sql`UPDATE observability.development_native_passes SET progress=${JSON.stringify(progress)}::jsonb,
      state=${progress.eof ? 'source-eof' : 'receiving'} WHERE pass_key=${meta.passKey}`);
    pass.progress = progress; pass.state = progress.eof ? 'source-eof' : 'receiving';
  }
  return { passKey: meta.passKey, duplicate, sourceComplete: pass.state === 'source-eof' };
}
/** Bounded scheduling page; the original continuation visits all retained work without a population cap. */
export async function pendingDevelopmentNativePasses(db: Executor, after: string | null, pageSize = 20) {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new RangeError('Invalid native work packet size');
  const rows = await db.execute<PassRow>(sql`SELECT pass_key,document,fingerprint,progress,state,work_state
    FROM observability.development_native_passes WHERE work_state='pending'
      ${after === null ? sql`` : sql`AND pass_key>${after}`} ORDER BY pass_key LIMIT ${pageSize + 1}`);
  const items = rows.slice(0, pageSize);
  return { items, nextCursor: rows.length > pageSize ? items.at(-1)!.pass_key : null };
}
