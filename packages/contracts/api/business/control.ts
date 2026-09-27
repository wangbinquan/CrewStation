import { z } from 'zod';
import { ReleaseIdSchema, ResourceIdSchema } from '../../ids';
import { BusinessDigestSchema, BusinessGenerationSchema } from './executionValues';

export const BusinessExecutionFenceSchema = z.strictObject({ epoch: BusinessGenerationSchema, leaseId: ResourceIdSchema, instanceId: ResourceIdSchema });
export const BusinessControlClaimSchema = z.strictObject({ instanceId: ResourceIdSchema });
export const BusinessControlLeaseRequestSchema = z.strictObject({ expectedEpoch: BusinessGenerationSchema, leaseId: ResourceIdSchema, instanceId: ResourceIdSchema });
export const BusinessControlActivateSchema = BusinessControlLeaseRequestSchema.extend({ preparationDigest: BusinessDigestSchema });
export const BusinessHandoffReadySchema = BusinessControlActivateSchema.extend({ operationId: ResourceIdSchema, acceptedTaskContractVersions: z.array(z.string().min(1).max(128)).min(1).max(128) });

export const BusinessMigrationReadySchema = z.strictObject({ operationId: ResourceIdSchema, expectedEpoch: BusinessGenerationSchema, preparationDigest: BusinessDigestSchema });
export type BusinessMigrationReady = z.infer<typeof BusinessMigrationReadySchema>;

export const BusinessControlDtoSchema = z.strictObject({
  activeReleaseId: ReleaseIdSchema.nullable(), physicalSlot: z.enum(['blue', 'green']).nullable(), epoch: BusinessGenerationSchema,
  phase: z.enum(['inactive', 'frozen', 'preparing', 'active']),
  leaseOwner: ResourceIdSchema.nullable(), leaseExpiresAt: z.iso.datetime().nullable(),
  leaseId: ResourceIdSchema.optional(), operationId: ResourceIdSchema.optional(),
  migration: z.strictObject({ operationId: ResourceIdSchema, targetReleaseId: ReleaseIdSchema, applicationReady: z.boolean() }).optional(),
});

export type BusinessExecutionFence = z.infer<typeof BusinessExecutionFenceSchema>;
export type BusinessControlClaim = z.infer<typeof BusinessControlClaimSchema>;
export type BusinessControlLeaseRequest = z.infer<typeof BusinessControlLeaseRequestSchema>;
export type BusinessControlActivate = z.infer<typeof BusinessControlActivateSchema>;
export type BusinessHandoffReady = z.infer<typeof BusinessHandoffReadySchema>;
export type BusinessControlDto = z.infer<typeof BusinessControlDtoSchema>;
