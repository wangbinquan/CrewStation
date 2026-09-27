import { z } from 'zod';
import { BUSINESS_EXECUTION_LIMITS, BusinessDigestSchema, BusinessRelativePathSchema } from './executionValues';

export const BusinessFileQuerySchema = z.strictObject({
  path: BusinessRelativePathSchema, offset: z.coerce.number<number | string>().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  limit: z.coerce.number<number | string>().int().min(1).max(BUSINESS_EXECUTION_LIMITS.fileChunkBytes).default(BUSINESS_EXECUTION_LIMITS.fileChunkBytes),
  version: BusinessDigestSchema.optional(),
}).refine((query) => query.offset === 0 || query.version !== undefined, '分块续读必须带文件版本');
export const BusinessDirectoryQuerySchema = z.strictObject({
  path: z.union([z.literal('.'), BusinessRelativePathSchema]).default('.'), after: z.string().max(4096).optional(),
  limit: z.coerce.number<number | string>().int().min(1).max(1000).default(200),
});
export const BusinessFileDtoSchema = z.strictObject({
  path: BusinessRelativePathSchema, version: BusinessDigestSchema, size: z.number().int().min(0),
  offset: z.number().int().min(0), contentBase64: z.string(), nextOffset: z.number().int().min(0).nullable(),
});
export const BusinessDirectoryDtoSchema = z.strictObject({
  path: z.string(), entries: z.array(z.strictObject({ name: z.string(), kind: z.enum(['file', 'dir', 'symlink']), size: z.number().int().min(0), modifiedAt: z.iso.datetime() })), nextCursor: z.string().nullable(),
});

export type BusinessFileQuery = z.infer<typeof BusinessFileQuerySchema>;
export type BusinessDirectoryQuery = z.infer<typeof BusinessDirectoryQuerySchema>;
export type BusinessFileDto = z.infer<typeof BusinessFileDtoSchema>;
export type BusinessDirectoryDto = z.infer<typeof BusinessDirectoryDtoSchema>;

export type BusinessFileQueryInput = z.input<typeof BusinessFileQuerySchema>;
export type BusinessDirectoryQueryInput = z.input<typeof BusinessDirectoryQuerySchema>;
