import { z } from 'zod';
import { ResourceIdSchema } from '../../ids';
import { ArchivePathSchema, ObjectDigestSchema, StorageBytesSchema } from './values';

export const TaskInputObjectSchema = z.strictObject({ objectId: ResourceIdSchema, sha256: ObjectDigestSchema, path: ArchivePathSchema });
export const TaskInputObjectsSchema = z.array(TaskInputObjectSchema).min(1).max(100).refine((items) => {
  const paths = items.map((item) => item.path).sort();
  return paths.every((path, i) => !paths.some((other, j) => i !== j && (path === other || path.startsWith(`${other}/`))));
}, '输入文件路径不能重复或互为父目录');
export const TaskInputManifestSchema = z.strictObject({ completed: z.boolean(), items: z.array(TaskInputObjectSchema.extend({ size: StorageBytesSchema })).max(100) });
export type TaskInputObject = z.infer<typeof TaskInputObjectSchema>;
export type TaskInputManifest = z.infer<typeof TaskInputManifestSchema>;
