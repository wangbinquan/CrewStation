import { z } from 'zod';
import { RuntimeImageRelativePathSchema } from './values';

export const RuntimeImageInlinePathSchema = RuntimeImageRelativePathSchema.refine((path) =>
  new TextEncoder().encode(path).length <= 512 && path.split('/').every((part) => part !== '.' && part !== '.git' && new TextEncoder().encode(part).length <= 255) && !['dockerfile', '.dockerignore'].includes(path.split('/')[0]!.toLowerCase()), '构建文件路径冲突、过长或占用平台保留文件');
const Base64Schema = z.string().max(699052).refine((value) => {
  if (value.length > 699052) return false;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  try { return btoa(atob(value)) === value; } catch { return false; }
}, '文件必须使用规范 base64 编码');

export const RuntimeImageInlineFilesSchema = z.array(z.object({ path: RuntimeImageInlinePathSchema, contentBase64: Base64Schema, executable: z.boolean().default(false) }).strict()).max(32)
  .refine((files) => files.reduce((size, file) => size + file.contentBase64.length * 3 / 4 - (file.contentBase64.endsWith('==') ? 2 : file.contentBase64.endsWith('=') ? 1 : 0), 0) <= 512 * 1024, '构建文件总大小不能超过 512 KiB')
  .refine((files) => files.every((file, index) => files.every((other, otherIndex) => index === otherIndex || (file.path !== other.path && !file.path.startsWith(`${other.path}/`)))), '构建文件路径重复或文件与目录冲突');

export const RuntimeImageDockerfileContentSchema = z.string().min(1).max(256 * 1024).refine((value) => value.trim().length > 0 && !value.includes('\0') && new TextEncoder().encode(value).length <= 256 * 1024, 'Dockerfile 不能为空、含 NUL 或超过 256 KiB');
