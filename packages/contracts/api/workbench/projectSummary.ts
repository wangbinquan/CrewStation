import { z } from 'zod';
import { TaskIdSchema, UserIdSchema } from '../../ids';
import { HealthDtoSchema } from '../observability';
import { ReleaseDtoSchema, SlotDtoSchema, TrafficSwitchDtoSchema } from '../release';
import { ProjectPageEntrySchema } from './projectPage';

export const summaryPart = <T extends z.ZodType>(value: T) => z.discriminatedUnion('status', [
  z.object({ status: z.literal('ready'), value, checkedAt: z.iso.datetime() }),
  z.object({ status: z.literal('unknown'), reason: z.enum(['unavailable', 'invalid', 'timeout', 'not-provided']), checkedAt: z.iso.datetime() }),
  z.object({ status: z.literal('restricted'), checkedAt: z.iso.datetime() }),
]);
export const DevelopmentSummarySchema = z.object({
  taskId: TaskIdSchema, state: z.enum(['creating', 'running', 'paused', 'releasing', 'released', 'failed']),
  connected: z.boolean(), branch: z.string().optional(), createdBy: UserIdSchema.optional(),
  createdAt: z.iso.datetime(), lastActivityAt: z.iso.datetime(), message: z.string().optional(),
});
export const ProjectSummarySchema = ProjectPageEntrySchema.extend({
  development: summaryPart(DevelopmentSummarySchema.nullable()),
  slots: summaryPart(z.array(SlotDtoSchema).max(2)), health: summaryPart(z.array(HealthDtoSchema).max(2)),
  checkedAt: z.iso.datetime(),
});
export const ProjectSummariesPageSchema = z.object({ items: z.array(ProjectSummarySchema).max(50), nextCursor: z.string().optional() });
export const ProjectSummaryDetailSchema = ProjectSummarySchema.extend({
  releases: summaryPart(z.array(ReleaseDtoSchema).max(5)), switches: summaryPart(z.array(TrafficSwitchDtoSchema).max(5)),
});
export type DevelopmentSummary = z.infer<typeof DevelopmentSummarySchema>;
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;
export type ProjectSummaryDetail = z.infer<typeof ProjectSummaryDetailSchema>;
export type ProjectSummariesPage = z.infer<typeof ProjectSummariesPageSchema>;
