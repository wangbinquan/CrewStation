import { z } from 'zod';
import { ReleaseIdSchema, ResourceIdSchema } from '../../ids';
import { BUSINESS_EXECUTION_VERSION, BusinessGenerationSchema } from './executionValues';

export const BusinessAgentCapabilitiesSchema = z.strictObject({
  events: z.boolean(), usage: z.enum(['none', 'final', 'incremental']), resume: z.boolean(),
  systemPrompt: z.boolean(), skills: z.boolean(), mcp: z.boolean(), platformDelegation: z.boolean(), opaqueInternalDelegation: z.boolean(),
});
export const BusinessCapabilitiesDtoSchema = z.strictObject({
  protocolVersion: z.literal(BUSINESS_EXECUTION_VERSION), releaseId: ReleaseIdSchema,
  limits: z.strictObject({
    materialBytes: z.number().int().positive(), materialFiles: z.number().int().positive(), eventBytes: z.number().int().positive(), outputBytes: z.number().int().positive(),
    summaryBytes: z.number().int().positive(), fileChunkBytes: z.number().int().positive(), eventPageDefault: z.number().int().positive(), eventPageMax: z.number().int().positive(),
    retentionDays: z.number().int().positive(), leaseSeconds: z.number().int().positive(), renewSeconds: z.number().int().positive(),
  }),
  agentProfiles: z.array(z.strictObject({ agentProfileId: ResourceIdSchema, computeProfileId: ResourceIdSchema, profileRevision: BusinessGenerationSchema, capabilities: BusinessAgentCapabilitiesSchema })),
});

export type BusinessAgentCapabilities = z.infer<typeof BusinessAgentCapabilitiesSchema>;
export type BusinessCapabilitiesDto = z.infer<typeof BusinessCapabilitiesDtoSchema>;

/** Written only by the profile compatibility test, bound to that test revision and image. */
export const BusinessExecutionProofSchema = z.strictObject({ protocolVersion: z.literal(3), capabilities: BusinessAgentCapabilitiesSchema });
export type BusinessExecutionProof = z.infer<typeof BusinessExecutionProofSchema>;
