import { validation } from '@crewstation/kernel';
import type { Context } from 'hono';
import type { z } from 'zod';

export async function parseBody<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw validation('请求体必须是 JSON');
  }
  return parseWith(schema, raw, 'body');
}

export function parseQuery<T extends z.ZodTypeAny>(c: Context, schema: T): z.infer<T> {
  return parseWith(schema, c.req.query(), 'query');
}

export function parseParams<T extends z.ZodTypeAny>(c: Context, schema: T): z.infer<T> {
  return parseWith(schema, c.req.param(), 'params');
}

function parseWith<T extends z.ZodTypeAny>(schema: T, raw: unknown, where: string): z.infer<T> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  throw validation(`${where} 校验失败：${issues.map((i) => `${i.path || '$'}: ${i.message}`).join('；')}`, { issues });
}
