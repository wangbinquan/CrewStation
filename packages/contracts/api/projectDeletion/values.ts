import { z } from 'zod';
import { ProjectIdSchema, ResourceIdSchema, ServiceIdSchema, SlugSchema } from '../../ids';
import { ManifestKindSchema } from '../../manifest/serviceSpec';
import { ProjectStateSchema } from '../project';

/** 所有项目资源所有者必须登记；缺少任一个报告时不得把盘点解释为空。 */
export const PROJECT_DELETION_PARTICIPANTS = [
  'project', 'provisioning', 'gateway', 'identity', 'events', 'api-catalog', 'release',
  'runtime-environment', 'dev-session', 'business-task', 'task-runtime', 'session',
  'data', 'data-control', 'scm', 'config', 'agent-runtime', 'resource-access',
  'observability', 'cluster-management', 'resources', 'cluster-control',
] as const;
export const ProjectDeletionParticipantSchema = z.enum(PROJECT_DELETION_PARTICIPANTS);
export const PROJECT_DELETION_PHASES = ['seal', 'stop', 'purge', 'prove', 'namespace', 'metadata', 'verify'] as const;
export const ProjectDeletionPhaseSchema = z.enum(PROJECT_DELETION_PHASES);
export const ProjectDeletionDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const ProjectDeletionStateSchema = z.enum(['accepted', 'running', 'needs-attention', 'succeeded']);

export const ProjectDeletionTargetSchema = z.object({
  id: ProjectIdSchema, slug: SlugSchema, name: z.string().min(1).max(80),
  namespace: z.string().min(1), serviceId: ServiceIdSchema.optional(), kind: ManifestKindSchema, state: ProjectStateSchema,
  revision: z.string().regex(/^[0-9]+$/), prodHost: z.string().min(1), previewHost: z.string().min(1), serviceHost: z.string().min(1),
}).strict();
export const ProjectDeletionResourceSchema = z.object({
  kind: z.string().min(1).max(100), id: z.string().min(1).max(512),
  /** UID、OID、remoteProjectId、placementRevision 等来源身份；禁止携带配置或凭据原文。 */
  identity: z.string().min(1).max(1024), count: z.number().int().nonnegative().default(1),
}).strict();
export const ProjectDeletionBlockerSchema = z.object({
  participant: ProjectDeletionParticipantSchema, code: z.string().min(1).max(100), message: z.string().min(1).max(1000), resourceId: z.string().max(512).optional(),
}).strict();
export const ProjectDeletionReferenceSchema = z.object({
  kind: z.string().min(1).max(100), id: z.string().min(1).max(512), projectId: ProjectIdSchema.optional(), description: z.string().min(1).max(1000),
}).strict();
export const ProjectDeletionInventorySchema = z.object({
  participant: ProjectDeletionParticipantSchema, revision: ProjectDeletionDigestSchema, complete: z.boolean(),
  resources: z.array(ProjectDeletionResourceSchema), references: z.array(ProjectDeletionReferenceSchema), blockers: z.array(ProjectDeletionBlockerSchema),
}).strict();
export const ProjectDeletionEvidenceSchema = z.object({
  kind: z.enum(['physical', 'metadata', 'not-applicable']), digest: ProjectDeletionDigestSchema,
  description: z.string().min(1).max(1000), count: z.number().int().nonnegative(),
}).strict();
export const ProjectDeletionReceiptSchema = z.object({
  participant: ProjectDeletionParticipantSchema, phase: ProjectDeletionPhaseSchema, evidence: ProjectDeletionEvidenceSchema,
  completedAt: z.iso.datetime(), generation: z.number().int().positive(),
}).strict();
export const AcceptProjectDeletionSchema = z.object({ planId: ResourceIdSchema, requestKey: ResourceIdSchema, confirm: z.literal('delete') }).strict();

export type ProjectDeletionParticipant = z.infer<typeof ProjectDeletionParticipantSchema>;
export type ProjectDeletionPhase = z.infer<typeof ProjectDeletionPhaseSchema>;
export type ProjectDeletionTarget = z.infer<typeof ProjectDeletionTargetSchema>;
export type ProjectDeletionInventory = z.infer<typeof ProjectDeletionInventorySchema>;
export type ProjectDeletionBlocker = z.infer<typeof ProjectDeletionBlockerSchema>;
export type ProjectDeletionEvidence = z.infer<typeof ProjectDeletionEvidenceSchema>;
export type ProjectDeletionReceipt = z.infer<typeof ProjectDeletionReceiptSchema>;
export type AcceptProjectDeletion = z.infer<typeof AcceptProjectDeletionSchema>;
