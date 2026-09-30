import { z } from 'zod';
import { ResourceIdSchema } from '../../ids';
import { ProjectDeletionBlockerSchema, ProjectDeletionEvidenceSchema, ProjectDeletionInventorySchema, ProjectDeletionPhaseSchema, ProjectDeletionTargetSchema } from './values';
import type { ProjectDeletionParticipant } from './values';

/** 仅由持久清理工作器构造；owner 必须经反转端口验证许可及自己收到的原身份摘要。 */
export const ProjectDeletionContextSchema = z.object({
  operationId: ResourceIdSchema, generation: z.number().int().positive(), target: ProjectDeletionTargetSchema,
  phase: ProjectDeletionPhaseSchema, confirmed: ProjectDeletionInventorySchema,
}).strict();
export const ProjectDeletionStepResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('done'), evidence: ProjectDeletionEvidenceSchema }).strict(),
  z.object({ kind: z.literal('waiting'), reason: z.string().min(1).max(1000) }).strict(),
  z.object({ kind: z.literal('blocked'), blockers: z.array(ProjectDeletionBlockerSchema).min(1) }).strict(),
]);
export type ProjectDeletionContext = z.infer<typeof ProjectDeletionContextSchema>;
export type ProjectDeletionStepResult = z.infer<typeof ProjectDeletionStepResultSchema>;
export interface ProjectDeletionOwner {
  readonly participant: ProjectDeletionParticipant;
  inspect(target: z.infer<typeof ProjectDeletionTargetSchema>): Promise<z.infer<typeof ProjectDeletionInventorySchema>>;
  run(context: ProjectDeletionContext): Promise<ProjectDeletionStepResult>;
}
