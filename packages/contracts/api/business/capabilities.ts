import { z } from 'zod';
import { ReleaseIdSchema, ResourceIdSchema } from '../../ids';
import { BUSINESS_EXECUTION_VERSION, BusinessGenerationSchema } from './executionValues';

export const BusinessAgentCapabilitiesSchema = z.strictObject({
  nativeModelMappingVersion: z.literal(1).optional(), nativeConfigVersion: z.literal(1).optional(), materialObjectsVersion: z.literal(1).optional(), startupInventoryVersion: z.literal(1).optional(),
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
  commandSecretEnvVersion: z.literal(1).optional(),
  nativeMaterialLimits: z.strictObject({ files: z.number().int().positive(), bytes: z.number().int().positive(), descriptorBytes: z.number().int().positive().optional() }).optional(),
  storage: z.strictObject({ version: z.literal(1), objects: z.boolean(), taskInputs: z.boolean(), finalization: z.boolean(), unavailableReason: z.string().nullable() }).optional(),
  agentProfiles: z.array(z.strictObject({ agentProfileId: ResourceIdSchema, computeProfileId: ResourceIdSchema, profileRevision: BusinessGenerationSchema, capabilities: BusinessAgentCapabilitiesSchema })),
});

export type BusinessAgentCapabilities = z.infer<typeof BusinessAgentCapabilitiesSchema>;
export type BusinessCapabilitiesDto = z.infer<typeof BusinessCapabilitiesDtoSchema>;

/**
 * Written only by the profile compatibility test, bound to that test revision and image. `nativeProbeVersion: 2` marks a
 * proof whose native material probes exercised a sub-agent, inline remote and local MCP and a plugin, and the structured
 * model-material wire (RFC-040 V12); native capabilities of older proofs are not claimed.
 */
export const BusinessExecutionProofSchema = z.strictObject({ protocolVersion: z.literal(3), capabilities: BusinessAgentCapabilitiesSchema, nativeProbeVersion: z.literal(2).optional() });
export type BusinessExecutionProof = z.infer<typeof BusinessExecutionProofSchema>;
