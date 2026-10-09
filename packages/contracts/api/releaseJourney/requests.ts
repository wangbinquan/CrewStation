import { z } from 'zod';
import { ReleaseIdSchema } from '../../ids';
import { FullCommitShaSchema } from '../scm';
import { ReleaseTargetRevisionSchema } from './values';

export const ReleaseJourneyPageRequestSchema = z.object({
  cursor: z.string().min(1).max(1024).optional(), limit: z.coerce.number().int().min(1).max(50).default(20),
  tag: z.string().regex(/^v\d+\.\d+\.\d+$/).max(80).optional(),
  filter: z.enum(['active', 'ended']).optional(),
}).strict();
export const VerifyReleaseJourneyRequestSchema = z.object({
  requestKey: z.string().min(1).max(128), expectedRevision: z.number().int().nonnegative(),
  expectedReleaseId: ReleaseIdSchema, expectedCommitSha: FullCommitShaSchema, expectedTargetRevision: ReleaseTargetRevisionSchema,
  note: z.string().max(500).optional(),
}).strict();
export type ReleaseJourneyPageRequest = z.infer<typeof ReleaseJourneyPageRequestSchema>;
export type VerifyReleaseJourneyRequest = z.infer<typeof VerifyReleaseJourneyRequestSchema>;
