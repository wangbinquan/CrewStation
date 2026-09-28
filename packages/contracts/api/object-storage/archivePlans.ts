import { z } from 'zod';
import { ResourceIdSchema, TaskIdSchema } from '../../ids';
import { ArchivePathSchema, ObjectDigestSchema, ObjectNameSchema, StorageBytesSchema, StorageRevisionSchema, OBJECT_STORAGE_LIMITS } from './values';
import { ObjectWriteAuthoritySchema } from './requests';

export const ArchivePlanEntrySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('file'), path: ArchivePathSchema, name: ObjectNameSchema, required: z.boolean().default(true), expectedSize: StorageBytesSchema.max(OBJECT_STORAGE_LIMITS.objectBytes).optional() }),
  z.strictObject({ kind: z.literal('object'), objectId: ResourceIdSchema, name: ObjectNameSchema }),
]);
export const ArchivePlanPageSchema = ObjectWriteAuthoritySchema.extend({
  expectedRevision: StorageRevisionSchema, page: z.number().int().min(0).max(99),
  entries: z.array(ArchivePlanEntrySchema).min(1).max(OBJECT_STORAGE_LIMITS.pageItems),
}).superRefine((input, ctx) => {
  const names = new Set<string>(), paths = new Set<string>();
  for (const [index, entry] of input.entries.entries()) {
    if (names.has(entry.name)) ctx.addIssue({ code: 'custom', path: ['entries', index, 'name'], message: '产物别名重复' });
    names.add(entry.name);
    if (entry.kind === 'file') {
      if (paths.has(entry.path)) ctx.addIssue({ code: 'custom', path: ['entries', index, 'path'], message: '文件路径重复' });
      paths.add(entry.path);
    }
  }
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > OBJECT_STORAGE_LIMITS.pageBytes) ctx.addIssue({ code: 'custom', message: '清单页超过 256 KiB' });
});
export const CreateArchivePlanSchema = ObjectWriteAuthoritySchema;
export const SealArchivePlanSchema = ObjectWriteAuthoritySchema.extend({ expectedRevision: StorageRevisionSchema });
export const SealedArchivePlanSchema = z.strictObject({
  planId: ResourceIdSchema, planRevision: StorageRevisionSchema, digest: ObjectDigestSchema,
});
export const ArchivePlanDtoSchema = z.strictObject({
  id: ResourceIdSchema, taskId: TaskIdSchema, revision: StorageRevisionSchema, state: z.enum(['draft', 'sealed', 'bound', 'aborted']),
  digest: ObjectDigestSchema.nullable(), itemCount: z.number().int().min(0).max(OBJECT_STORAGE_LIMITS.archiveFiles),
  byteCount: StorageBytesSchema, createdAt: z.iso.datetime(),
});

export type ArchivePlanEntry = z.infer<typeof ArchivePlanEntrySchema>;
export type ArchivePlanPage = z.infer<typeof ArchivePlanPageSchema>;
export type SealedArchivePlan = z.infer<typeof SealedArchivePlanSchema>;
export type ArchivePlanDto = z.infer<typeof ArchivePlanDtoSchema>;
export const ArchivePlanEntriesQuerySchema = z.strictObject({
  expectedRevision: z.coerce.number().int().positive(), offset: z.coerce.number().int().min(0).max(OBJECT_STORAGE_LIMITS.archiveFiles).default(0),
  limit: z.coerce.number().int().min(1).max(OBJECT_STORAGE_LIMITS.pageItems).default(OBJECT_STORAGE_LIMITS.pageItems),
});
export const ArchivePlanEntriesDtoSchema = z.strictObject({
  revision: StorageRevisionSchema, items: z.array(ArchivePlanEntrySchema).max(OBJECT_STORAGE_LIMITS.pageItems), nextOffset: z.number().int().nonnegative().nullable(),
});
export type CreateArchivePlan = z.infer<typeof CreateArchivePlanSchema>;
export type SealArchivePlan = z.infer<typeof SealArchivePlanSchema>;
export type ArchivePlanEntriesQuery = z.infer<typeof ArchivePlanEntriesQuerySchema>;
export type ArchivePlanEntriesDto = z.infer<typeof ArchivePlanEntriesDtoSchema>;
