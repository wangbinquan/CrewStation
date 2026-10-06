import { z } from 'zod';
import { ProjectIdSchema, UserIdSchema } from '../../ids';
import type { Actor } from '../actor';
import type { ProjectDeletionTarget } from './values';

const hash = z.string().regex(/^[a-f0-9]{64}$/), text = z.string().min(1).max(1000);
export const ProjectDeletionRepairDecisionSchema = z.enum(['retain', 'reclaim']);
export const ProjectDeletionRepairItemSchema = z.object({
  owner: z.enum(['business-task', 'gateway', 'provisioning', 'data-control']), key: text, title: text,
  originalDigest: hash, evidenceDigest: hash, facts: z.array(z.object({ label: text, value: text }).strict()),
  allowedDecisions: z.array(ProjectDeletionRepairDecisionSchema), blockers: z.array(text),
  confirmed: z.object({ decision: ProjectDeletionRepairDecisionSchema, actorId: UserIdSchema, confirmedAt: z.iso.datetime() }).strict().nullable(),
}).strict();
export const ConfirmProjectDeletionRepairSchema = z.object({
  owner: ProjectDeletionRepairItemSchema.shape.owner, key: text, originalDigest: hash, evidenceDigest: hash,
  decision: ProjectDeletionRepairDecisionSchema,
}).strict();
export const ProjectDeletionRepairListSchema = z.object({
  version: z.literal('operator-confirmed/v1'), projectId: ProjectIdSchema, complete: z.boolean(), items: z.array(ProjectDeletionRepairItemSchema), blockers: z.array(text),
}).strict();
export type ProjectDeletionRepairItem = z.infer<typeof ProjectDeletionRepairItemSchema>;
export type ConfirmProjectDeletionRepair = z.infer<typeof ConfirmProjectDeletionRepairSchema>;
export type ProjectDeletionRepairList = z.infer<typeof ProjectDeletionRepairListSchema>;
/** Trusted composition invokes owners after rechecking the administrator. Every owner stores only its own facts. */
export interface ProjectDeletionRepairOwner {
  inspect(target: ProjectDeletionTarget): Promise<ProjectDeletionRepairItem[]>;
  confirm(target: ProjectDeletionTarget, actor: Actor, input: ConfirmProjectDeletionRepair): Promise<ProjectDeletionRepairItem>;
}
export interface ProjectDeletionCurrentPod {
  namespace: string; name: string; uid: string; labels: Readonly<Record<string, string>>;
  phase: string | null; terminating: boolean; containersComplete: boolean;
  containers: readonly { name: string; id: string | null }[];
}
/** Current Kubernetes witness only; it is never an original callback exit or storage reclamation receipt. */
export interface ProjectDeletionCurrentAssets {
  inspect(target: ProjectDeletionTarget, selectors: { ids: readonly string[]; pods?: readonly { namespace: string; name: string; uid: string | null }[] }): Promise<{
    complete: true; digest: string; activeConsumers: readonly string[]; targetReferences: readonly string[]; pods?: readonly ProjectDeletionCurrentPod[];
  }>;
}
