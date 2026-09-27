import { z } from 'zod';
import { BUSINESS_EXECUTION_LIMITS, BusinessRelativePathSchema } from './executionValues';

/** Source files pinned to the release commit; tasks do not need a checkout to consume them. */
export const BusinessReleaseMaterialsSchema = z.record(BusinessRelativePathSchema, z.string()).superRefine((files, ctx) => {
  if (Object.keys(files).length > BUSINESS_EXECUTION_LIMITS.materialFiles) ctx.addIssue({ code: 'custom', message: '发布执行文件过多' });
  if (new TextEncoder().encode(JSON.stringify(files)).byteLength > BUSINESS_EXECUTION_LIMITS.materialBytes) ctx.addIssue({ code: 'custom', message: '发布执行文件超过字节上限' });
});
export type BusinessReleaseMaterials = z.infer<typeof BusinessReleaseMaterialsSchema>;

export const BusinessOutputMaterialSchema = z.strictObject({
  id: z.string().min(1), required: z.array(BusinessRelativePathSchema).max(BUSINESS_EXECUTION_LIMITS.materialFiles),
  schemaDocument: z.string().max(BUSINESS_EXECUTION_LIMITS.materialBytes).optional(),
});
export type BusinessOutputMaterial = z.infer<typeof BusinessOutputMaterialSchema>;
