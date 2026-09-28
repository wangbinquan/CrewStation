import type { Context } from 'hono';
import type { z } from 'zod';
import { payloadTooLarge, validation } from '@crewstation/kernel';

/** Limit actual streamed bytes, including chunked requests; Content-Length is not an admission proof. */
export async function objectBody<T extends z.ZodType>(c: Context, schema: T, limit = 32_768): Promise<z.infer<T>> {
  const reader = c.req.raw.body?.getReader();
  if (!reader) throw validation('对象请求需要 JSON');
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > limit) { await reader.cancel(); throw payloadTooLarge('对象元数据请求过大'); } chunks.push(item.value); } }
  finally { reader.releaseLock(); }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw validation('对象请求需要 JSON'); }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw validation('对象请求校验失败', { issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) });
  return parsed.data;
}
