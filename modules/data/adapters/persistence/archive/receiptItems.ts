import { ObjectDigestSchema, OBJECT_STORAGE_LIMITS, ResourceIdSchema, type ArchiveReceiptItem } from '@crewstation/contracts';
import { jsonHash, precondition, validation } from '@crewstation/kernel';
import { and, eq, sql } from 'drizzle-orm';
import type { Executor } from '@crewstation/persistence';
import type { FinalizationBinding } from '../../../domain/objectStorage';
import type { ArchiveCompletion } from '../../../ports/archiveBindings';
import { archiveObjects } from './references';
import { requireArchivePlan } from './plans';
import { archiveFileResults, archiveHelperGrants } from './helperTables';

export async function verifyReceiptItems(tx: Executor, binding: FinalizationBinding, input: ArchiveCompletion): Promise<void> {
  ResourceIdSchema.parse(input.receiptId); ObjectDigestSchema.parse(input.stopProofDigest); ObjectDigestSchema.parse(input.completionProofDigest);
  if (input.items.length > OBJECT_STORAGE_LIMITS.archiveFiles) throw validation('收据超过文件数上限');
  const plan = binding.planId ? await requireArchivePlan(tx, binding.planId) : undefined;
  if (!plan) {
    if (input.items.length || input.disposition !== (binding.volumeUid ? 'empty' : 'never-provisioned')) throw precondition('空清单的资源处置与收据不一致');
    return;
  }
  if (input.disposition !== 'archived' || plan.state !== 'bound' || plan.revision !== binding.planRevision || plan.digest !== binding.manifestDigest) throw precondition('收据不对应当前封存清单');
  if (input.items.length !== plan.entries.length || new Set(input.items.map((item) => item.name)).size !== input.items.length) throw precondition('收据必须逐项解释当前清单');
  const entries = new Map(plan.entries.map((entry) => [entry.name, entry]));
  const objects = new Map((await archiveObjects(tx, binding.spaceId, savedArchiveIds(input.items))).map((o) => [o.id, o]));
  const files = new Map((await tx.select().from(archiveFileResults).where(and(eq(archiveFileResults.bindingId, binding.id), eq(archiveFileResults.revision, binding.revision))).limit(OBJECT_STORAGE_LIMITS.archiveFiles)).map(({ body }) => [body.path, body.item]));
  let bytes = 0;
  for (const item of input.items) {
    const entry = entries.get(item.name);
    if (!entry || item.state === 'lost') throw precondition('普通收据不能包含未声明或丢失的文件');
    if (item.state === 'omitted') {
      if (entry.kind !== 'file' || entry.required || !item.reason.trim()) throw precondition('必需产物缺失，保留工作卷');
      if (jsonHash(files.get(entry.path) ?? null) !== jsonHash(item)) throw precondition('缺少归档助手的文件检查结果');
      continue;
    }
    const object = objects.get(item.objectId)!;
    if (object.spaceId !== binding.spaceId || object.sha256 !== item.sha256 || object.size !== item.size) throw precondition('收据与已验证对象不一致');
    if (entry.kind === 'object' && entry.objectId !== object.id) throw precondition('收据替换了已选对象');
    if (entry.kind === 'file' && (!binding.volumeUid || object.archive?.bindingId !== binding.id || object.archive.revision !== binding.revision || object.archive.path !== entry.path || (entry.expectedSize !== undefined && entry.expectedSize !== object.size))) throw precondition('文件不是当前工作卷归档尝试的已验证输出');
    if (entry.kind === 'file' && jsonHash(files.get(entry.path) ?? null) !== jsonHash(item)) throw precondition('缺少归档助手的文件检查结果');
    bytes += item.size;
  }
  if (bytes > OBJECT_STORAGE_LIMITS.archiveBytes) throw precondition('实际归档产物超过总大小上限');
  if (plan.entries.some((entry) => entry.kind === 'file') && !(await tx.select({ id: archiveHelperGrants.id }).from(archiveHelperGrants)
    .where(and(eq(archiveHelperGrants.bindingId, binding.id), eq(archiveHelperGrants.revision, binding.revision), sql`${archiveHelperGrants.body}->>'completedAt' IS NOT NULL`)).limit(1)).length) throw precondition('缺少归档助手的清单完成确认');
}
export function savedArchiveIds(items: readonly ArchiveReceiptItem[]): string[] {
  return [...new Set(items.flatMap((item) => item.state === 'saved' ? [item.objectId] : []))];
}
