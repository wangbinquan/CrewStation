import { z } from 'zod';
import { ResourceIdSchema } from '../../ids';
import { BusinessEnvironmentNameSchema } from './executionValues';

/** Only the restricted Runner command carries rendered values; the durable plan retains these stamps. */
export const BusinessCommandSecretEnvironmentSchema = z.strictObject({
  version: z.literal(1), nonce: z.string().regex(/^[a-f0-9]{64}$/),
  references: z.record(BusinessEnvironmentNameSchema, ResourceIdSchema),
  versions: z.array(z.strictObject({ definitionId: ResourceIdSchema, itemId: ResourceIdSchema, version: z.number().int().positive() })).max(32),
}).superRefine((value, ctx) => {
  const ids = new Set(Object.values(value.references)), stamps = new Set(value.versions.map((s) => s.definitionId));
  if (!ids.size || ids.size !== stamps.size || stamps.size !== value.versions.length || [...ids].some((id) => !stamps.has(id))) ctx.addIssue({ code: 'custom', message: 'Secret 引用与固定版本不匹配' });
});
export const BusinessRenderedCommandEnvironmentSchema = z.record(BusinessEnvironmentNameSchema, z.string().max(32768).refine((value) => !value.includes('\0'), '环境变量值不能含 NUL'));
export type BusinessCommandSecretEnvironment = z.infer<typeof BusinessCommandSecretEnvironmentSchema>;
