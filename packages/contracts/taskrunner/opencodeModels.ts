import { z } from 'zod';
import { ResourceIdSchema } from '../ids';
import { EnvNameSchema } from './beforeStart';

const key = z.string().min(1).max(200).refine((value) => !['__proto__', 'constructor', 'prototype'].includes(value));
const providerId = z.string().regex(/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u).max(128);
const data = z.record(key, z.json()).superRefine((value, ctx) => {
  const visit = (item: unknown, depth: number): boolean => {
    if (depth > 16) return false;
    if (typeof item === 'string') return !/\{(?:env|file):/.test(item) && !item.includes('\0');
    if (!item || typeof item !== 'object') return true;
    return Object.entries(item).every(([name, nested]) => key.safeParse(name).success && !/^(api[-_]?key|authorization|password|token|secret)$/i.test(name) && visit(nested, depth + 1));
  };
  if (typeof value.baseURL === 'string') {
    try { const url = new URL(value.baseURL); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) ctx.addIssue({ code: 'custom', message: 'baseURL 必须是无内嵌凭据的 HTTP(S) 地址' }); } catch { ctx.addIssue({ code: 'custom', message: 'baseURL 必须是 HTTP(S) 地址' }); }
  }
  if (!visit(value, 0) || JSON.stringify(value).length > 65536) ctx.addIssue({ code: 'custom', message: '模型材料只接受有界非秘密 JSON；凭据通过声明的 Secret 引用提供，不允许动态环境或文件替换' });
});
// Validate the original input before Zod record parsing can drop __proto__ keys.
const providerInput = z.unknown().refine((value) => {
  const visit = (item: unknown, depth: number): boolean => {
    if (depth > 18) return false;
    if (!item || typeof item !== 'object') return true;
    const prototype = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) return false;
    return Object.entries(item).every(([name, nested]) => !['__proto__', 'constructor', 'prototype'].includes(name) && visit(nested, depth + 1));
  };
  return visit(value, 0);
}, '模型材料不允许原型键、非 JSON 对象或过深嵌套');
/** Administrator-owned, revisioned material. Secret references are declared profile variable names. */
export const OpencodeProviderSchema = providerInput.pipe(z.strictObject({
  id: providerId,
  npm: z.string().regex(/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+(?:@[a-zA-Z0-9._~^+-]+)?$/).max(256),
  name: z.string().min(1).max(128).optional(),
  models: z.record(key, data).refine((models) => Object.keys(models).length > 0 && Object.keys(models).length <= 128),
  options: data.default({}),
  credentials: z.strictObject({ apiKey: EnvNameSchema.optional(), headers: z.record(key, EnvNameSchema).optional() }).default({}),
}));
export type OpencodeProvider = z.infer<typeof OpencodeProviderSchema>;
/**
 * Runner-only; business material APIs never accept this field. Version 2 carries, per stable internal alias, the
 * administrator's structured provider material and only the secret values that material declares; agent-drivers is the
 * single place that renders OpenCode provider config (RFC-040 V12). Runners advertise it as `nativeModelMaterialVersion`.
 */
export const PlatformOpencodeModelsSchema = z.strictObject({
  version: z.literal(2),
  root: z.string().min(1).max(300),
  subagents: z.record(key, z.string().min(1).max(300)),
  providers: z.record(providerId, z.strictObject({ provider: OpencodeProviderSchema, secrets: z.record(EnvNameSchema, z.string().max(65536)) })),
  identities: z.record(z.string().min(1).max(300), z.strictObject({ model: z.string().min(1).max(200), computeProfileId: ResourceIdSchema, revision: z.number().int().positive() })),
});
export type PlatformOpencodeModels = z.infer<typeof PlatformOpencodeModelsSchema>;
/** Declared credential variable names of a structured provider: the only secret values platform code forwards for it. */
export function opencodeProviderSecretNames(provider: Pick<OpencodeProvider, 'credentials'>): string[] {
  return [...new Set([...(provider.credentials.apiKey ? [provider.credentials.apiKey] : []), ...Object.values(provider.credentials.headers ?? {})])].sort();
}
