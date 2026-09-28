import { z } from 'zod';
import { ProjectIdSchema, ResourceIdSchema } from '../../ids';
import { BusinessExecutionFenceSchema } from '../business/control';
import {
  OBJECT_STORAGE_LIMITS, ObjectDigestSchema, ObjectNameSchema, StorageBackendStateSchema, StorageBytesSchema,
  StorageDurabilitySchema, StorageEndpointSchema, StorageRequestKeySchema, StorageRevisionSchema, StorageWindowSchema,
} from './values';

export const ObjectStorageDeclarationSchema = z.strictObject({ objects: z.strictObject({ planId: ResourceIdSchema }) });
export const ObjectWriteAuthoritySchema = z.strictObject({ requestKey: StorageRequestKeySchema, fence: BusinessExecutionFenceSchema.optional() });
export const CreateObjectUploadSchema = ObjectWriteAuthoritySchema.extend({
  name: ObjectNameSchema, size: StorageBytesSchema.max(OBJECT_STORAGE_LIMITS.objectBytes), sha256: ObjectDigestSchema,
  mediaType: z.string().min(1).max(255).regex(/^[\x20-\x7e]+$/).default('application/octet-stream'),
});
export const CommitObjectUploadSchema = ObjectWriteAuthoritySchema;
export const DeleteStoredObjectSchema = ObjectWriteAuthoritySchema.extend({ expectedRevision: StorageRevisionSchema });
export const ObjectReferenceSchema = ObjectWriteAuthoritySchema.extend({
  ownerType: z.enum(['application', 'material-version']), ownerId: z.string().min(1).max(256), revision: StorageRevisionSchema,
});
export const ObjectPageQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(256).optional(), limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const StorageMetricsQuerySchema = z.strictObject({ window: StorageWindowSchema.default('1h') });

export const RegisterObjectBackendSchema = z.strictObject({
  requestKey: StorageRequestKeySchema, name: z.string().trim().min(1).max(80), endpoint: StorageEndpointSchema,
  region: z.string().min(1).max(63).regex(/^[a-z0-9-]+$/).default('garage'),
  bucket: z.string().min(3).max(63).regex(/^[a-z0-9][a-z0-9.-]+[a-z0-9]$/).refine((value) => !value.includes('..')),
  accessKeyId: z.string().min(1).max(256), secretAccessKey: z.string().min(1).max(4096),
  monitoring: z.strictObject({ endpoint: StorageEndpointSchema, token: z.string().min(1).max(4096) }).optional(),
  durability: StorageDurabilitySchema, budgetBytes: StorageBytesSchema.positive().default(OBJECT_STORAGE_LIMITS.backendBytes),
});
export const UpdateObjectBackendSchema = z.strictObject({
  expectedRevision: StorageRevisionSchema, state: StorageBackendStateSchema,
  name: z.string().trim().min(1).max(80), budgetBytes: StorageBytesSchema.positive(),
});
export const RotateObjectBackendCredentialSchema = z.strictObject({
  requestKey: StorageRequestKeySchema, expectedRevision: StorageRevisionSchema,
  accessKeyId: z.string().min(1).max(256), secretAccessKey: z.string().min(1).max(4096), monitoringToken: z.string().min(1).max(4096).optional(),
  reason: z.string().trim().min(1).max(1024), confirmation: z.literal('rotate'),
});
export const ObjectStoragePlanInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(80), backendId: ResourceIdSchema,
  quotaBytes: StorageBytesSchema.positive().default(OBJECT_STORAGE_LIMITS.spaceBytes),
  maxObjectBytes: StorageBytesSchema.positive().max(OBJECT_STORAGE_LIMITS.objectBytes).default(OBJECT_STORAGE_LIMITS.objectBytes),
  maxConcurrentTransfers: z.number().int().min(1).max(64).default(OBJECT_STORAGE_LIMITS.transfers), enabled: z.boolean().default(true),
}).refine((input) => input.maxObjectBytes <= input.quotaBytes, '单对象上限不能超过空间配额');
export const AuthorizeObjectStoragePlansSchema = z.strictObject({
  projectId: ProjectIdSchema, expectedRevision: StorageRevisionSchema, planIds: z.array(ResourceIdSchema).max(128),
}).refine((input) => new Set(input.planIds).size === input.planIds.length, '档位不能重复');

export type ObjectStorageDeclaration = z.infer<typeof ObjectStorageDeclarationSchema>;
export type CreateObjectUpload = z.infer<typeof CreateObjectUploadSchema>;
export type CommitObjectUpload = z.infer<typeof CommitObjectUploadSchema>;
export type DeleteStoredObject = z.infer<typeof DeleteStoredObjectSchema>;
export type ObjectReferenceInput = z.infer<typeof ObjectReferenceSchema>;
export type ObjectPageQuery = z.infer<typeof ObjectPageQuerySchema>;
export type RegisterObjectBackend = z.infer<typeof RegisterObjectBackendSchema>;
export type UpdateObjectBackend = z.infer<typeof UpdateObjectBackendSchema>;
export type RotateObjectBackendCredential = z.infer<typeof RotateObjectBackendCredentialSchema>;
export type ObjectStoragePlanInput = z.infer<typeof ObjectStoragePlanInputSchema>;
export type AuthorizeObjectStoragePlans = z.infer<typeof AuthorizeObjectStoragePlansSchema>;
