import { z } from 'zod';
import { ResourceIdSchema, UserIdSchema } from '../../ids';
import { KnownAgentProtocolSchema } from '../../taskrunner/launch';

export const CnyTokenRateSchema = z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/, '人民币单价须为非负小数，最多 6 位小数').nullable();
export const CnyTokenRatesSchema = z.strictObject({
  input: CnyTokenRateSchema, cacheRead: CnyTokenRateSchema,
  cacheWrite: CnyTokenRateSchema, output: CnyTokenRateSchema,
});
export const SaveTokenPriceSchema = z.strictObject({
  expectedRevision: z.number().int().min(0).max(2147483646),
  requestKey: z.string().min(8).max(128),
  profileRevision: z.number().int().positive(),
  protocol: KnownAgentProtocolSchema,
  provider: z.string().trim().min(1).max(200),
  model: z.string().trim().min(1).max(300),
  condition: z.string().trim().min(1).max(200).nullable(),
  currency: z.literal('CNY'),
  rates: CnyTokenRatesSchema,
  effectiveFrom: z.iso.datetime(),
  sourceNote: z.string().trim().min(1).max(2000),
});
export const TokenPriceVersionSchema = SaveTokenPriceSchema.omit({ expectedRevision: true, requestKey: true }).extend({
  id: ResourceIdSchema, profileId: ResourceIdSchema, revision: z.number().int().positive(),
  createdAt: z.iso.datetime(), createdBy: UserIdSchema,
});
export const TokenPriceProfileSchema = z.object({
  id: ResourceIdSchema, name: z.string(), revision: z.number().int().positive(),
  protocol: z.enum(['opencode', 'claude-code', 'terminal']), model: z.string().nullable(),
  pricingRevision: z.number().int().nonnegative(),
});
export const TokenPricePageQuerySchema = z.object({
  beforeRevision: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type CnyTokenRates = z.infer<typeof CnyTokenRatesSchema>;
export type SaveTokenPrice = z.infer<typeof SaveTokenPriceSchema>;
export type TokenPriceVersion = z.infer<typeof TokenPriceVersionSchema>;
export type TokenPriceProfile = z.infer<typeof TokenPriceProfileSchema>;
export type TokenPricePageQuery = z.infer<typeof TokenPricePageQuerySchema>;
export interface TokenPriceHistory {
  items: TokenPriceVersion[];
  revision: number;
  nextBeforeRevision?: number;
}
