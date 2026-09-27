import { BUSINESS_EXECUTION_LIMITS, BusinessMaterialRequestSchema } from '@crewstation/contracts';
import { payloadTooLarge, validation } from '@crewstation/kernel';
import type { Context } from 'hono';
import type { z } from 'zod';

const MAX_BODY = 2 * 1024 * 1024;
export async function executionBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const reader = c.req.raw.body?.getReader();
  if (!reader) throw validation('请求体必须是 JSON', { code: 'invalid_configuration' });
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const result = await reader.read(); if (result.done) break;
      size += result.value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); throw payloadTooLarge('执行请求超过容量', { code: 'payload_too_large' }); }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  let raw: unknown;
  try { raw = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw validation('请求体必须是 JSON', { code: 'invalid_configuration' }); }
  if ((schema as z.ZodType) === BusinessMaterialRequestSchema && raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const { fence: _fence, requestKey: _key, ...material } = raw as Record<string, unknown>;
    if (Buffer.byteLength(JSON.stringify(material)) > BUSINESS_EXECUTION_LIMITS.materialBytes || (Array.isArray(material['skills']) && material['skills'].length > BUSINESS_EXECUTION_LIMITS.materialFiles)) throw payloadTooLarge('执行材料超过容量', { code: 'material_too_large' });
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw validation('业务执行请求校验失败', { code: parsed.error.issues.some((issue) => issue.code === 'unrecognized_keys') ? 'unknown_field' : 'invalid_configuration', issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) });
}
