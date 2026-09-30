import { z } from 'zod';
import { ProjectIdSchema, ResourceIdSchema, ServiceIdSchema } from '../../ids';
import { DataEnvSchema } from '../data';
import {
  ObjectDigestSchema, ObjectNameSchema, ObjectStateSchema, ObjectUploadStateSchema, StorageBackendStateSchema, StorageBytesSchema,
  StorageDurabilitySchema, StorageEndpointSchema, StorageHealthSchema, StorageRevisionSchema,
} from './values';

export const ObjectBackendDtoSchema = z.strictObject({
  id: ResourceIdSchema, name: z.string(), endpoint: StorageEndpointSchema, region: z.string(), bucket: z.string(),
  revision: StorageRevisionSchema, placementRevision: StorageRevisionSchema, credentialRevision: StorageRevisionSchema,
  state: StorageBackendStateSchema, health: StorageHealthSchema, durability: StorageDurabilitySchema,
  durabilityVerifiedAt: z.iso.datetime().nullable(), budgetBytes: StorageBytesSchema, reservedBytes: StorageBytesSchema,
  physicalFreeBytes: StorageBytesSchema.nullable(), physicalTotalBytes: StorageBytesSchema.nullable(),
  physicalObservedAt: z.iso.datetime().nullable().optional(),
  observedAt: z.iso.datetime().nullable(), message: z.string().nullable(), createdAt: z.iso.datetime(),
});
export const ObjectStoragePlanDtoSchema = z.strictObject({
  id: ResourceIdSchema, name: z.string(), backendId: ResourceIdSchema, revision: StorageRevisionSchema,
  quotaBytes: StorageBytesSchema, maxObjectBytes: StorageBytesSchema, maxConcurrentTransfers: z.number().int().positive(), enabled: z.boolean(),
});
export const ObjectProjectPolicyDtoSchema = z.strictObject({ projectId: ProjectIdSchema, revision: StorageRevisionSchema, planIds: z.array(ResourceIdSchema) });
export const ObjectSpaceDtoSchema = z.strictObject({
  id: ResourceIdSchema, projectId: ProjectIdSchema, serviceId: ServiceIdSchema, env: DataEnvSchema,
  serviceSlug: z.string().nullable().optional(),
  backendId: ResourceIdSchema, backendPlacementRevision: StorageRevisionSchema, planId: ResourceIdSchema, planRevision: StorageRevisionSchema,
  revision: StorageRevisionSchema, health: StorageHealthSchema, quotaBytes: StorageBytesSchema, usedBytes: StorageBytesSchema,
  reservedBytes: StorageBytesSchema, deletingBytes: StorageBytesSchema, objectCount: StorageBytesSchema, createdAt: z.iso.datetime(),
  maxObjectBytes: StorageBytesSchema.optional(), maxConcurrentTransfers: z.number().int().positive().optional(),
  quotaRevision: z.number().int().min(0).optional(), quotaSource: z.enum(['plan', 'project']).optional(),
});
export const StoredObjectDtoSchema = z.strictObject({
  id: ResourceIdSchema, spaceId: ResourceIdSchema, revision: StorageRevisionSchema, name: ObjectNameSchema,
  size: StorageBytesSchema, sha256: ObjectDigestSchema, mediaType: z.string(), state: ObjectStateSchema,
  referenceCount: z.number().int().min(0), createdAt: z.iso.datetime(), verifiedAt: z.iso.datetime().nullable(), message: z.string().nullable(),
});
export const ObjectUploadDtoSchema = z.strictObject({
  id: ResourceIdSchema, spaceId: ResourceIdSchema, state: ObjectUploadStateSchema, receivedBytes: StorageBytesSchema,
  size: StorageBytesSchema, objectId: ResourceIdSchema.nullable(), operationId: ResourceIdSchema.nullable(),
  errorCode: z.string().nullable(), retryable: z.boolean(), nextRetryAt: z.iso.datetime().nullable(), createdAt: z.iso.datetime(),
});
export const StoredObjectPageSchema = z.strictObject({ items: z.array(StoredObjectDtoSchema), nextCursor: z.string().nullable() });
export const ObjectOperationDtoSchema = z.strictObject({ operationId: ResourceIdSchema, state: z.enum(['pending', 'running', 'blocked', 'completed']) });

export type ObjectBackendDto = z.infer<typeof ObjectBackendDtoSchema>;
export type ObjectStoragePlanDto = z.infer<typeof ObjectStoragePlanDtoSchema>;
export type ObjectProjectPolicyDto = z.infer<typeof ObjectProjectPolicyDtoSchema>;
export type ObjectSpaceDto = z.infer<typeof ObjectSpaceDtoSchema>;
export type StoredObjectDto = z.infer<typeof StoredObjectDtoSchema>;
export type ObjectUploadDto = z.infer<typeof ObjectUploadDtoSchema>;
export type StoredObjectPage = z.infer<typeof StoredObjectPageSchema>;
export type ObjectOperationDto = z.infer<typeof ObjectOperationDtoSchema>;
