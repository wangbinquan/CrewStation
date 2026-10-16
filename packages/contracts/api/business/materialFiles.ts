import { z } from 'zod';
import { ResourceIdSchema } from '../../ids';
import type { ProjectId, ServiceId } from '../../ids';
import { ObjectDigestSchema, StorageBytesSchema, OBJECT_STORAGE_LIMITS } from '../object-storage/values';
import { BusinessRelativePathSchema, BUSINESS_EXECUTION_LIMITS } from './executionValues';

export const BUSINESS_NATIVE_MATERIAL_LIMITS = { files: 10_000, bytes: OBJECT_STORAGE_LIMITS.objectBytes } as const;
export const BusinessMaterialObjectSchema = z.strictObject({ objectId: ResourceIdSchema, sha256: ObjectDigestSchema, size: StorageBytesSchema.max(OBJECT_STORAGE_LIMITS.objectBytes) });
export const BusinessMaterialFileSchema = z.strictObject({
  path: BusinessRelativePathSchema, mode: z.number().int().min(0).max(0o777).optional(),
  content: z.string().max(BUSINESS_EXECUTION_LIMITS.materialBytes).optional(), object: BusinessMaterialObjectSchema.optional(),
}).refine((file) => (file.content === undefined) !== (file.object === undefined), '文件必须且只能指定 content 或 object');
export const BusinessPluginFileSchema = z.discriminatedUnion('kind', [
  BusinessMaterialFileSchema.safeExtend({ kind: z.literal('file') }),
  z.strictObject({ path: BusinessRelativePathSchema, kind: z.literal('symlink'), target: z.string().min(1).max(4096).refine((v) => !v.startsWith('/') && !/[\\\u0000-\u001f\u007f]/u.test(v), '链接目标必须是树内相对路径') }),
]);
export type BusinessMaterialObject = z.infer<typeof BusinessMaterialObjectSchema>;
export type BusinessMaterialFile = z.infer<typeof BusinessMaterialFileSchema>;
export type BusinessPluginFile = z.infer<typeof BusinessPluginFileSchema>;

/** Wire paths are POSIX. Validate the complete tree before creating any file, directory or link. */
export function materialTreeIssue(files: readonly BusinessPluginFile[], entry?: string): string | undefined {
  const byPath = new Map<string, BusinessPluginFile>();
  const dirs = new Set<string>();
  for (const file of files) {
    if (file.path !== file.path.normalize('NFC') || byPath.has(file.path)) return 'duplicate-or-aliased-path';
    byPath.set(file.path, file);
    const pieces = file.path.split('/');
    for (let n = 1; n < pieces.length; n++) dirs.add(pieces.slice(0, n).join('/'));
  }
  for (const path of byPath.keys()) if (dirs.has(path)) return 'file-or-link-ancestor';
  const resolve = (path: string, chain: Set<string>): boolean => {
    const parts = path.split('/'), out: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      if (part === '' || part === '.') continue;
      if (part === '..') { if (!out.length) return false; out.pop(); continue; }
      out.push(part);
      const at = out.join('/'), file = byPath.get(at);
      if (file?.kind === 'symlink') {
        if (chain.has(at) || chain.size >= 64 || !file.target || file.target.startsWith('/')) return false;
        const next = new Set(chain); next.add(at);
        return resolve([...out.slice(0, -1), file.target, ...parts.slice(i + 1)].join('/'), next);
      }
      if (i < parts.length - 1 && file?.kind === 'file') return false;
    }
    const result = out.join('/');
    return !!result && (byPath.has(result) || dirs.has(result));
  };
  for (const file of byPath.values()) if (file.kind === 'symlink' && !resolve(file.path, new Set())) return 'invalid-link-chain';
  if (entry && (!byPath.has(entry) && !dirs.has(entry) || !resolve(entry, new Set()))) return 'missing-entry';
  return undefined;
}

/** Immutable ownership and descriptors shared by internal material capabilities. */
export interface BusinessMaterialObjectScope { projectId: ProjectId; serviceId: ServiceId; materialId: string; objects: readonly BusinessMaterialObject[] }
