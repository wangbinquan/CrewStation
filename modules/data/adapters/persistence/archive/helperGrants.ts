import { and, desc, eq, sql } from 'drizzle-orm';
import { ArchiveHelperFailureSchema, OBJECT_STORAGE_LIMITS, ObjectDigestSchema, ResourceIdSchema } from '@crewstation/contracts';
import { conflict, forbidden, jsonHash, precondition, validation } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import type { ArchiveHelperRepository } from '../../../ports/archiveHelpers';
import type { ArchiveFileResult, ArchiveHelperGrant } from '../../../domain/archiveHelper';
import { assertBindingRevision, assertSameStorageRequest } from '../../../domain/objectStorage';
import { objectStorageTransaction } from '../objectCatalog';
import { archiveFileResults, archiveHelperClosures, archiveHelperGrants } from './helperTables';
import { archiveUnfrozen, requireArchiveBinding } from './bindingState';
import { requireArchivePlan } from './plans';
import { authorizeArchiveHelper } from './uploadAuthority';
import { archiveObjects } from './references';

async function activeGrant(tx: Executor, input: ArchiveHelperGrant, now: Date) {
  const grant = (await tx.select().from(archiveHelperGrants).where(eq(archiveHelperGrants.id, input.id)))[0]?.body;
  if (!grant || !grant.podUid || grant.podUid !== input.podUid || grant.tokenHash !== input.tokenHash || grant.closedAt || grant.failure || Date.parse(grant.expiresAt) <= now.getTime()) throw forbidden('归档助手凭证无效或已到期');
  const binding = await requireArchiveBinding(tx, grant.bindingId);
  assertBindingRevision(binding, grant.revision, true);
  if (binding.state !== 'bound') throw precondition('归档操作不再接收文件');
  return { binding, grant };
}

/** Every write shares data's binding lock with revise/receipt; expiry never supplies a stop proof. */
export function archiveHelperRepository(db: Database): ArchiveHelperRepository {
  return {
    grant: (input) => objectStorageTransaction(db, async (tx, now) => {
      ResourceIdSchema.parse(input.id); ResourceIdSchema.parse(input.consumerId); ObjectDigestSchema.parse(input.tokenHash);
      if ((await tx.select().from(archiveHelperClosures).where(eq(archiveHelperClosures.id, input.id))).length) throw conflict('归档助手启动已关闭');
      const previous = (await tx.select().from(archiveHelperGrants).where(eq(archiveHelperGrants.id, input.id)))[0]?.body;
      if (previous) { assertSameStorageRequest(jsonHash({ ...previous, closedAt: null, podUid: null, completedAt: undefined, failure: undefined }), jsonHash(input)); if (previous.closedAt || previous.completedAt || previous.failure) throw conflict('归档助手已关闭'); return; }
      const binding = await requireArchiveBinding(tx, input.bindingId); assertBindingRevision(binding, input.revision, true);
      await archiveUnfrozen(tx, binding);
      if (binding.state !== 'bound' || !binding.volumeUid || !binding.planId) throw precondition('没有需要归档的工作卷');
      const duration = Date.parse(input.expiresAt) - now.getTime();
      if (input.podUid !== null || input.closedAt !== null || !Number.isFinite(duration) || duration <= 0 || duration > 65 * 60_000) throw validation('归档助手凭证最多有效一小时');
      const live = await tx.select({ id: archiveHelperGrants.id }).from(archiveHelperGrants).where(and(eq(archiveHelperGrants.bindingId, input.bindingId), sql`${archiveHelperGrants.body}->>'closedAt' IS NULL`)).limit(1);
      if (live.length) throw conflict('旧归档助手尚未确认停止');
      await tx.insert(archiveHelperGrants).values({ id: input.id, bindingId: input.bindingId, revision: input.revision, body: input });
    }),
    close: (id) => objectStorageTransaction(db, async (tx, now) => {
      ResourceIdSchema.parse(id);
      await tx.insert(archiveHelperClosures).values({ id }).onConflictDoNothing();
      const grant = (await tx.select().from(archiveHelperGrants).where(eq(archiveHelperGrants.id, id)))[0]?.body;
      if (!grant) return;
      if (!grant.closedAt) await tx.update(archiveHelperGrants).set({ body: { ...grant, closedAt: now.toISOString() } }).where(eq(archiveHelperGrants.id, id));
    }),
    bind: (id, podUid) => bindGrant(db, id, podUid),
    authenticate: async (id, tokenHash, podUid) => {
      const grant = (await db.select().from(archiveHelperGrants).where(eq(archiveHelperGrants.id, id)))[0]?.body;
      if (!grant || !podUid || grant.podUid !== podUid || grant.tokenHash !== tokenHash) throw forbidden('归档助手凭证无效');
      return (await activeGrant(db, grant, new Date())).grant;
    },
    complete: (id, tokenHash, podUid) => objectStorageTransaction(db, async (tx, now) => {
      const grant = (await tx.select().from(archiveHelperGrants).where(eq(archiveHelperGrants.id, id)))[0]?.body;
      if (!grant || !podUid || grant.podUid !== podUid || grant.tokenHash !== tokenHash || grant.closedAt || Date.parse(grant.expiresAt) <= now.getTime()) throw forbidden('归档助手凭证无效');
      if (grant.completedAt) return;
      const { binding } = await activeGrant(tx, grant, now); await archiveUnfrozen(tx, binding);
      const plan = await requireArchivePlan(tx, binding.planId!);
      const recorded = new Set((await tx.select({ path: archiveFileResults.path }).from(archiveFileResults).where(and(eq(archiveFileResults.bindingId, binding.id), eq(archiveFileResults.revision, binding.revision))).limit(OBJECT_STORAGE_LIMITS.archiveFiles)).map((r) => r.path));
      if (plan.entries.some((entry) => entry.kind === 'file' && !recorded.has(entry.path))) throw precondition('归档清单尚有未检查的文件');
      await tx.update(archiveHelperGrants).set({ body: { ...grant, completedAt: now.toISOString() } }).where(eq(archiveHelperGrants.id, id));
    }),
    completed: async (bindingId, revision) => (await db.select({ id: archiveHelperGrants.id }).from(archiveHelperGrants).where(and(eq(archiveHelperGrants.bindingId, bindingId), eq(archiveHelperGrants.revision, revision), sql`${archiveHelperGrants.body}->>'completedAt' IS NOT NULL`)).limit(1)).length > 0,
    ...helperFailures(db),
    entries: async (input, offset, limit) => {
      if (!Number.isInteger(offset) || offset < 0 || offset > OBJECT_STORAGE_LIMITS.archiveFiles || !Number.isInteger(limit) || limit < 1 || limit > 100) throw validation('归档文件分页无效');
      const { binding } = await activeGrant(db, input, new Date());
      const plan = await requireArchivePlan(db, binding.planId!);
      let bytes = 128;
      const items = [];
      for (const entry of plan.entries.slice(offset, offset + limit)) {
        const size = Buffer.byteLength(JSON.stringify(entry)) + 1;
        if (bytes + size > OBJECT_STORAGE_LIMITS.pageBytes) break;
        bytes += size; items.push(entry);
      }
      if (!items.length && offset < plan.entries.length) throw precondition('归档条目超过分页上限');
      return { items, nextOffset: offset + items.length < plan.entries.length ? offset + items.length : null };
    },
    record: (authority, result) => objectStorageTransaction(db, async (tx, now) => {
      const { binding, entry } = await authorizeArchiveHelper(tx, authority, now);
      let item: ArchiveFileResult['item'];
      if ('omitted' in result) {
        if (entry.required || result.omitted !== 'not-found') throw precondition('必需产物缺失，不能跳过', { code: 'archive_file_missing' });
        item = { state: 'omitted', name: entry.name, reason: '文件不存在' };
      } else {
        const [object] = await archiveObjects(tx, binding.spaceId, [result.objectId]);
        if (!object || object.archive?.bindingId !== binding.id || object.archive.revision !== binding.revision || object.archive.path !== entry.path) throw precondition('文件尚未读回验证或不属于此归档', { code: 'archive_file_unverified' });
        item = { state: 'saved', name: entry.name, objectId: object.id, size: object.size, sha256: object.sha256 };
      }
      const record: ArchiveFileResult = { bindingId: binding.id, revision: binding.revision, path: entry.path, item };
      const where = and(eq(archiveFileResults.bindingId, binding.id), eq(archiveFileResults.revision, binding.revision), eq(archiveFileResults.path, entry.path));
      const old = (await tx.select().from(archiveFileResults).where(where))[0]?.body;
      if (old) { assertSameStorageRequest(jsonHash(old), jsonHash(record)); return old; }
      await tx.insert(archiveFileResults).values({ bindingId: binding.id, revision: binding.revision, path: entry.path, body: record }); return record;
    }),
    results: async (bindingId, revision) => (await db.select().from(archiveFileResults).where(and(eq(archiveFileResults.bindingId, bindingId), eq(archiveFileResults.revision, revision))).orderBy(archiveFileResults.path).limit(OBJECT_STORAGE_LIMITS.archiveFiles)).map((row) => row.body),
  };
}

function helperFailures(db: Database): Pick<ArchiveHelperRepository, 'fail' | 'failure'> {
  return {
    fail: (id, tokenHash, podUid, input) => objectStorageTransaction(db, async (tx, now) => {
      const failure = ArchiveHelperFailureSchema.parse(input), grant = (await tx.select().from(archiveHelperGrants).where(eq(archiveHelperGrants.id, id)))[0]?.body;
      if (!grant || !podUid || grant.podUid !== podUid || grant.tokenHash !== tokenHash || grant.closedAt || grant.completedAt || Date.parse(grant.expiresAt) <= now.getTime()) throw forbidden('归档助手不再接收失败回执');
      if (grant.failure) { assertSameStorageRequest(jsonHash({ code: grant.failure.code, path: grant.failure.path }), jsonHash(failure)); return; }
      const { binding } = await activeGrant(tx, grant, now); await archiveUnfrozen(tx, binding);
      const plan = await requireArchivePlan(tx, binding.planId!);
      if (failure.path && !plan.entries.some((entry) => entry.kind === 'file' && entry.path === failure.path)) throw validation('失败路径不属于此归档清单');
      const retryAt = ['archive_transfer_failed', 'archive_upload_blocked'].includes(failure.code) ? new Date(now.getTime() + 60_000).toISOString() : null;
      await tx.update(archiveHelperGrants).set({ body: { ...grant, failure: { ...failure, at: now.toISOString(), retryAt } } }).where(eq(archiveHelperGrants.id, id));
    }),
    failure: async (bindingId, revision) => (await db.select().from(archiveHelperGrants).where(and(eq(archiveHelperGrants.bindingId, bindingId), eq(archiveHelperGrants.revision, revision))).orderBy(desc(archiveHelperGrants.id)).limit(1))[0]?.body.failure,
  };
}

async function bindGrant(db: Database, id: string, podUid: string): Promise<void> {
  ResourceIdSchema.parse(podUid);
  return objectStorageTransaction(db, async (tx, now) => {
    const grant = (await tx.select().from(archiveHelperGrants).where(eq(archiveHelperGrants.id, id)))[0]?.body;
    if (!grant || grant.closedAt || Date.parse(grant.expiresAt) <= now.getTime()) throw precondition('归档助手不再等待绑定');
    if (grant.podUid && grant.podUid !== podUid) throw conflict('归档助手凭证已经绑定另一个 Pod');
    if (!grant.podUid) await tx.update(archiveHelperGrants).set({ body: { ...grant, podUid } }).where(eq(archiveHelperGrants.id, id));
  });
}
