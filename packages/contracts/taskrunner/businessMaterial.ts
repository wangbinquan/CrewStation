import { z } from 'zod';
import { BusinessMaterialObjectSchema, BUSINESS_NATIVE_MATERIAL_LIMITS } from '../api/business/materialFiles';

export const BusinessMaterialDownloadSchema = z.strictObject({
  object: BusinessMaterialObjectSchema, url: z.url().refine((value) => { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash; }),
  token: z.string().min(1).max(4096), expiresAt: z.iso.datetime(),
});
export const BusinessMaterialDownloadsSchema = z.array(BusinessMaterialDownloadSchema).max(BUSINESS_NATIVE_MATERIAL_LIMITS.files).refine((items) => new Set(items.map((item) => item.object.objectId)).size === items.length, '下载对象重复');
export type BusinessMaterialDownload = z.infer<typeof BusinessMaterialDownloadSchema>;
