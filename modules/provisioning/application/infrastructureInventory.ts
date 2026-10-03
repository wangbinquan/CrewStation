import type { ProjectDeletionBlocker, ProjectDeletionInventory, ProjectId } from '@crewstation/contracts';
import { ProjectDeletionInventorySchema, ProjectIdSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import { z } from 'zod';
import type { InfrastructureContentInventory, InfrastructureContentRow, InfrastructureOrphanError, OwnedInfrastructureContent } from '../domain/infrastructureContents';
import type { InfrastructureContentReader, InfrastructureContentSource } from '../ports/infrastructureContents';
import type { InfrastructureOriginSources } from '../ports/infrastructureOrigins';
import { resolveInfrastructureOwnership } from './infrastructureOwnership';
import { isInfrastructureCoordinator } from '../domain/infrastructureCoordinator';
import type { InfrastructureCoordinator } from '../domain/infrastructureCoordinator';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[1-9][0-9]*$/).refine((value) => BigInt(value) <= 9223372036854775807n);
const content = z.object({ id, birthDigest: hash, contentDigest: hash, deadLetters: z.number().int().nonnegative(),
  document: z.object({ channel: z.enum(['queue', 'event']), name: z.string().min(1), payload: z.unknown(), legacyPayload: z.unknown(), identityProvenance: z.unknown() }).strict(),
}).strict();
const orphan = z.object({ eventId: id, consumer: z.string(), digest: hash }).strict();

// PostgreSQL's explicit C collation orders these cursors by UTF-8 bytes, including supplementary Unicode.
function afterError(value: InfrastructureOrphanError, previous: Pick<InfrastructureOrphanError, 'eventId' | 'consumer'>) {
  const delta = BigInt(value.eventId) - BigInt(previous.eventId);
  if (delta !== 0n) return delta > 0n;
  const left = new TextEncoder().encode(value.consumer), right = new TextEncoder().encode(previous.consumer);
  for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i]! > right[i]!;
  return left.length > right.length;
}

/** Complete content ownership only: EOF and source digests do not prove any original process stopped. */
export async function inspectInfrastructureContents(rawProjectId: ProjectId, source: InfrastructureContentSource, origins: InfrastructureOriginSources, coordinator?: InfrastructureCoordinator): Promise<InfrastructureContentInventory> {
  const projectId = ProjectIdSchema.parse(rawProjectId), contents: OwnedInfrastructureContent[] = [], resources: ProjectDeletionInventory['resources'] = [];
  if (coordinator && coordinator.projectId !== projectId) throw precondition('删除协调保留范围与盘点项目不符');
  const blockers: ProjectDeletionBlocker[] = [], evidence: string[] = [];
  const eof = { queue: false, event: false, orphanErrors: false }, scanned = { queue: 0, event: 0, orphanErrors: 0 };
  const blocked = (code: string, message: string, resourceId?: string) => {
    if (!blockers.some((entry) => entry.code === code && entry.resourceId === resourceId)) blockers.push({ participant: 'provisioning', code, message, ...(resourceId ? { resourceId } : {}) });
  };
  async function classify(row: InfrastructureContentRow) {
    const channel = row.document.channel, key = channel + ':' + row.id;
    try {
      if (coordinator && isInfrastructureCoordinator(row.document, coordinator)) return;
      const ownership = await resolveInfrastructureOwnership(row.document, origins);
      evidence.push(jsonHash({ channel, id: row.id, birth: row.birthDigest, content: row.contentDigest, ownership: ownership.digest }));
      if (!ownership.projectIds.includes(projectId)) return;
      if (ownership.projectIds.some((id) => id !== projectId)) {
        blocked('infrastructure-shared-content', '任务或事件同时属于其他项目，需要先解除共享归属', key); return;
      }
      const identity = jsonHash({ channel, id: row.id, birth: row.birthDigest, content: row.contentDigest, ownership: ownership.digest });
      const sourceIdentity = jsonHash({ channel, id: row.id, birth: row.birthDigest, origins: ownership.origins });
      contents.push({ channel, id: row.id, birthDigest: row.birthDigest, contentDigest: row.contentDigest, ownershipDigest: ownership.digest,
        projectIds: ownership.projectIds, deadLetters: row.deadLetters });
      resources.push({ kind: channel === 'queue' ? 'queued-job' : 'event-outbox', id: key, identity, sourceIdentity, scope: 'metadata', count: 1 });
      if (row.deadLetters) resources.push({ kind: 'event-errors', id: key, identity, sourceIdentity, scope: 'metadata', count: row.deadLetters });
    } catch {
      evidence.push(jsonHash({ channel, id: row.id, birth: row.birthDigest, content: row.contentDigest, unknown: true }));
      blocked('infrastructure-origin-unavailable', '任务或事件的原归属不完整，恢复来源后重新盘点', key);
    }
  }
  async function traverse(reader: InfrastructureContentReader, channel: 'queue' | 'event') {
    let after: string | null = null;
    try {
      for (;;) {
        const rows = await reader[channel](after);
        if (!Array.isArray(rows) || rows.length > 200) throw precondition('基础设施分页不完整');
        if (!rows.length) { eof[channel] = true; break; }
        for (const raw of rows) {
          const row = content.parse(raw);
          if (row.document.channel !== channel || after !== null && BigInt(row.id) <= BigInt(after) || channel === 'queue' && row.deadLetters !== 0)
            throw precondition('基础设施分页原身份不连续');
          scanned[channel]++; await classify(row); after = row.id;
        }
      }
    } catch { blocked('infrastructure-traversal-incomplete', '未能读尽任务或事件的全部分页，不能确认清理范围', channel); }
  }
  try {
    await source.withSnapshot(async (reader) => {
      await traverse(reader, 'queue'); await traverse(reader, 'event');
      let after: Pick<InfrastructureOrphanError, 'eventId' | 'consumer'> | null = null;
      try {
        for (;;) {
          const rows = await reader.orphanErrors(after);
          if (!Array.isArray(rows) || rows.length > 200) throw precondition('事件错误分页不完整');
          if (!rows.length) { eof.orphanErrors = true; break; }
          for (const raw of rows) {
            const row = orphan.parse(raw);
            if (after && !afterError(row, after)) throw precondition('事件错误分页原身份不连续');
            scanned.orphanErrors++; evidence.push(row.digest);
            blocked('infrastructure-orphan-error', '历史事件错误缺少原事件，不能推断其项目归属', 'event:' + row.eventId + ':' + jsonHash(row.consumer));
            after = { eventId: row.eventId, consumer: row.consumer };
          }
        }
      } catch { blocked('infrastructure-traversal-incomplete', '未能读尽全部历史事件错误，不能确认清理范围', 'orphan-errors'); }
    });
  } catch { blocked('infrastructure-snapshot-unavailable', '无法取得一致的基础设施只读快照，请恢复来源后重新盘点'); }
  const material = { participant: 'provisioning' as const, complete: !blockers.length && Object.values(eof).every(Boolean), resources, references: [], blockers };
  return { contents, inventory: ProjectDeletionInventorySchema.parse({ ...material, revision: jsonHash({ projectId, ...material }) }),
    traversal: { ...eof, scanned, digest: jsonHash({ projectId, eof, scanned, evidence }) } };
}
