import { z } from 'zod';
import { ProjectIdSchema, ReleaseIdSchema, ResourceIdSchema, ServiceIdSchema, TaskIdSchema, UserIdSchema } from '../../ids';
import { FullCommitShaSchema } from '../scm';

export const ReleaseJourneyKindSchema = z.enum(['publish', 'redeploy', 'promote', 'rollback']);
export const ReleaseJourneyStatusSchema = z.enum(['running', 'awaiting-verification', 'awaiting-confirmation', 'succeeded', 'failed', 'interrupted']);
export const ReleaseJourneyStageSchema = z.enum(['prepare', 'queued', 'build', 'migration', 'deploy', 'ready', 'verification', 'launch', 'freeze', 'handoff-prepare', 'route', 'activate', 'complete']);
export const ReleaseJourneyStageStateSchema = z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped', 'unknown']);
export const ReleaseJourneySourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('repository') }).strict(),
  z.object({ kind: z.literal('session'), taskId: TaskIdSchema }).strict(),
  z.object({ kind: z.literal('legacy') }).strict(),
  z.object({ kind: z.literal('external') }).strict(),
]);
/** Opaque identity of one deployment; changes on redeploy even when release and SHA do not. */
export const ReleaseTargetRevisionSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const ReleaseJourneySnapshotSchema = z.object({
  projectId: ProjectIdSchema, serviceId: ServiceIdSchema, releaseId: ReleaseIdSchema,
  kind: ReleaseJourneyKindSchema, source: ReleaseJourneySourceSchema,
  tag: z.string().min(1), commitSha: FullCommitShaSchema, branch: z.string().min(1),
  actorUserId: UserIdSchema, startedAt: z.iso.datetime(), message: z.string().max(500).optional(),
}).strict();
export const ReleaseJourneyEventSchema = z.object({
  id: ResourceIdSchema, journeyId: ResourceIdSchema, sequence: z.number().int().positive(),
  transitionKey: z.string().min(1).max(256), stage: ReleaseJourneyStageSchema, state: ReleaseJourneyStageStateSchema,
  at: z.iso.datetime(), actorUserId: UserIdSchema.optional(), reason: z.string().max(2000).optional(),
  targetRevision: ReleaseTargetRevisionSchema.optional(), handoffId: ResourceIdSchema.optional(), trafficSwitchId: ResourceIdSchema.optional(),
}).strict();
export const ReleaseJourneyStageDtoSchema = z.object({
  stage: ReleaseJourneyStageSchema, state: ReleaseJourneyStageStateSchema,
  startedAt: z.iso.datetime().optional(), finishedAt: z.iso.datetime().optional(), durationMs: z.number().nonnegative().optional(),
  reason: z.string().max(2000).optional(),
}).strict();
export type ReleaseJourneyKind = z.infer<typeof ReleaseJourneyKindSchema>;
export type ReleaseJourneyStatus = z.infer<typeof ReleaseJourneyStatusSchema>;
export type ReleaseJourneySource = z.infer<typeof ReleaseJourneySourceSchema>;
export type ReleaseJourneySnapshot = z.infer<typeof ReleaseJourneySnapshotSchema>;
export type ReleaseJourneyEvent = z.infer<typeof ReleaseJourneyEventSchema>;
export type ReleaseJourneyStageDto = z.infer<typeof ReleaseJourneyStageDtoSchema>;
