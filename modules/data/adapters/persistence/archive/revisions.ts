import { and, eq } from 'drizzle-orm';
import { integer, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { StorageRequestKeySchema } from '@crewstation/contracts';
import type { AcceptedArchiveRevision } from '@crewstation/contracts';
import { conflict, jsonHash, validation } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { jsonDocument } from '@crewstation/persistence';
import type { FinalizationBinding } from '../../../domain/objectStorage';
import { assertSameStorageRequest } from '../../../domain/objectStorage';
import type { ArchiveBindingRepository } from '../../../ports/archiveBindings';
import { dataSchema } from '../schema';

interface RevisionAudit { requestDigest: string; fromPlanId: string | null; toPlanId: string | null; fromDigest: string; toDigest: string; reason: string; serviceId: string; podUid: string | null; createdAt: string; acceptedChange?: Pick<AcceptedArchiveRevision, 'id' | 'actor'> }
const revisions = dataSchema.table('archive_binding_revisions', {
  bindingId: text('binding_id').notNull(), revision: integer('revision').notNull(), requestKey: text('request_key').notNull(), body: jsonDocument('body').$type<RevisionAudit>().notNull(),
}, (t) => [primaryKey({ columns: [t.bindingId, t.revision] }), uniqueIndex('archive_binding_revisions_request').on(t.bindingId, t.requestKey)]);

type RevisionInput = Parameters<ArchiveBindingRepository['revise']>[1];
export async function replayArchiveRevision(tx: Executor, binding: FinalizationBinding, input: RevisionInput): Promise<boolean> {
  StorageRequestKeySchema.parse(input.requestKey);
  if (!input.reason.trim() || input.reason.length > 1024) throw validation('清单修订必须提供明确原因');
  const previous = (await tx.select().from(revisions).where(and(eq(revisions.bindingId, binding.id), eq(revisions.requestKey, input.requestKey))))[0];
  if (!previous) return false;
  assertSameStorageRequest(previous.body.requestDigest, jsonHash(input));
  if (binding.revision < previous.revision) throw conflict('归档修订记录不完整');
  return true;
}
export async function recordArchiveRevision(tx: Executor, old: FinalizationBinding, next: FinalizationBinding, input: RevisionInput, authority: Parameters<ArchiveBindingRepository['revise']>[2], now: Date, acceptedChange?: RevisionAudit['acceptedChange']): Promise<void> {
  await tx.insert(revisions).values({ bindingId: next.id, revision: next.revision, requestKey: input.requestKey,
    body: { requestDigest: jsonHash(input), fromPlanId: old.planId, toPlanId: next.planId, fromDigest: old.manifestDigest, toDigest: next.manifestDigest, reason: input.reason, serviceId: authority.source.serviceId, podUid: authority.source.podUid ?? null, createdAt: now.toISOString(), acceptedChange } });
}
