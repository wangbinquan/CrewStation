import { z } from 'zod';

/** RFC-035 limits apply before allocation and again to the actual streamed bytes. */
export const OBJECT_STORAGE_LIMITS = {
  objectBytes: 1024 ** 3, archiveBytes: 10 * 1024 ** 3, archiveFiles: 10_000,
  manifestBytes: 16 * 1024 ** 2, pageBytes: 256 * 1024, pageItems: 100, pathBytes: 1024,
  spaceBytes: 20 * 1024 ** 3, backendBytes: 60 * 1024 ** 3, transfers: 4,
  firstByteSeconds: 30, idleSeconds: 60, transferSeconds: 1800, stagingIdleHours: 24,
} as const;

export const StorageRevisionSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const StorageBytesSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const ObjectDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const ObjectNameSchema = z.string().min(1).max(255).refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), '文件名不能含控制字符');
export const StorageRequestKeySchema = z.string().min(1).max(128).regex(/^[^\u0000-\u001f\u007f]+$/u);
export const CompletionPolicySchema = z.enum(['legacy', 'archive-and-delete']);
export const ObjectStateSchema = z.enum(['staging', 'verifying', 'ready', 'deleting', 'deleted', 'degraded']);
export const ObjectUploadStateSchema = z.enum(['waiting', 'uploading', 'verifying', 'ready', 'failed', 'aborted']);
export const StorageBackendStateSchema = z.enum(['active', 'no-new-spaces', 'no-new-writes', 'offline']);
export const StorageHealthSchema = z.enum(['unknown', 'ready', 'degraded', 'unavailable']);
export const StorageDurabilitySchema = z.enum(['dev-only', 'replicated']);
export const StorageWindowSchema = z.enum(['1h', '6h', '24h', '7d']);

/** Paths are wire-format POSIX relatives, never native paths or prefixes. */
export const ArchivePathSchema = z.string().min(1).max(OBJECT_STORAGE_LIMITS.pathBytes).refine((value) => {
  if (new TextEncoder().encode(value).byteLength > OBJECT_STORAGE_LIMITS.pathBytes || /[\\:*?\[\]\u0000-\u001f\u007f]/u.test(value)) return false;
  return value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..' && segment !== '.crewstation');
}, '必须是工作区内无通配符的相对文件路径');

export const StorageEndpointSchema = z.url().refine((value) => {
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/';
}, '后端地址只允许 HTTP(S) 根端点，不能包含凭据、查询或片段');

export type CompletionPolicy = z.infer<typeof CompletionPolicySchema>;
export type ObjectState = z.infer<typeof ObjectStateSchema>;
export type ObjectUploadState = z.infer<typeof ObjectUploadStateSchema>;
export type StorageBackendState = z.infer<typeof StorageBackendStateSchema>;
export type StorageHealth = z.infer<typeof StorageHealthSchema>;
export type StorageDurability = z.infer<typeof StorageDurabilitySchema>;
export type StorageWindow = z.infer<typeof StorageWindowSchema>;
