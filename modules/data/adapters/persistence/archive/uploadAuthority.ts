import { and, eq, sql } from 'drizzle-orm';
import { OBJECT_STORAGE_LIMITS } from '@crewstation/contracts';
import { conflict, forbidden, jsonHash, notFound, precondition } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import type { ArchiveHelperAuthority, ArchiveUploadIdentity } from '../../../domain/archiveHelper';
import type { ObjectSpaceRecord, ObjectUploadRecord } from '../../../domain/objectStorage';
import { assertBindingRevision } from '../../../domain/objectStorage';
import type { UploadAuthority } from '../../../ports/objectStorage';
import { authorizeObjectWrite } from '../objectCatalog';
import { objectUploads } from '../objectTables';
import { archiveUnfrozen, requireArchiveBinding } from './bindingState';
import { archiveHelperGrants } from './helperTables';
import { archivePlanFile } from './planFile';

export async function archiveFileEntry(tx: Executor, identity: ArchiveUploadIdentity, spaceId?: string) {
  const binding = await requireArchiveBinding(tx, identity.bindingId);
  if (spaceId && binding.spaceId !== spaceId) throw notFound('归档文件');
  assertBindingRevision(binding, identity.revision, true);
  if (binding.state !== 'bound' || !binding.volumeUid || !binding.planId) throw precondition('归档文件没有有效的原工作卷与清单');
  await archiveUnfrozen(tx, binding);
  const plan = await archivePlanFile(tx, binding.planId, identity.path);
  if (!plan) throw notFound('归档清单');
  if (plan.revision !== binding.planRevision || plan.digest !== binding.manifestDigest || plan.state !== 'bound') throw conflict('归档清单已变化');
  const entry = plan.entry;
  if (!entry || entry.kind !== 'file') throw notFound('清单文件');
  return { binding, plan, entry };
}

export async function authorizeArchiveHelper(tx: Executor, identity: ArchiveHelperAuthority, now: Date) {
  const grant = (await tx.select().from(archiveHelperGrants).where(eq(archiveHelperGrants.id, identity.grantId)))[0]?.body;
  if (!grant || !grant.podUid || grant.closedAt || grant.completedAt || grant.failure || grant.bindingId !== identity.bindingId || grant.revision !== identity.revision || Date.parse(grant.expiresAt) <= now.getTime()) throw forbidden('归档助手权限已失效');
  return archiveFileEntry(tx, identity);
}

/** Application uploads and helper uploads are disjoint authorities, including on replay. */
export async function authorizeUpload(tx: Executor, space: ObjectSpaceRecord, authority: UploadAuthority, now: Date, existing?: ObjectUploadRecord): Promise<void> {
  if (existing && Boolean(existing.archive) !== Boolean(authority.archive)) throw notFound('对象上传');
  if (!authority.archive) return authorizeObjectWrite(tx, space, authority.source, authority.fence, now);
  const { binding } = await authorizeArchiveHelper(tx, authority.archive, now);
  if (binding.spaceId !== space.id || space.projectId !== authority.source.projectId || space.serviceId !== authority.source.serviceId || space.env !== authority.source.env) throw notFound('归档空间');
  if (existing && (existing.archive?.bindingId !== binding.id || existing.archive.revision !== binding.revision || existing.archive.path !== authority.archive.path)) throw notFound('归档上传');
}

export async function assertArchiveReservation(tx: Executor, identity: ArchiveHelperAuthority, input: { name: string; size: number; requestKey: string }): Promise<void> {
  const { entry, plan } = await archiveFileEntry(tx, identity);
  if (input.requestKey !== `archive:${identity.bindingId}:${identity.revision}:${jsonHash(identity.path)}`) throw conflict('归档文件只能保留一个不可变上传');
  if (entry.name !== input.name || (entry.expectedSize !== undefined && entry.expectedSize !== input.size)) throw precondition('归档文件不符合封存清单', { code: 'archive_file_changed' });
  const [row] = await tx.select({ bytes: sql<string>`coalesce(sum((${objectUploads.body}->>'size')::bigint), 0)` }).from(objectUploads)
    .where(and(sql`${objectUploads.body}->'archive'->>'bindingId' = ${identity.bindingId}`, sql`(${objectUploads.body}->'archive'->>'revision')::integer = ${identity.revision}`));
  // The plan's byteCount includes declared file sizes. Count selected objects separately to avoid double counting files.
  if (Number(row?.bytes ?? 0) + plan.objectBytes + input.size > OBJECT_STORAGE_LIMITS.archiveBytes) throw precondition('归档文件实际总大小超过上限');
}
