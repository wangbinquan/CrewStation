import { z } from 'zod';
import { ReleaseIdSchema, ResourceIdSchema, UserIdSchema } from '../../ids';
import { ReleaseDtoSchema, SlotDtoSchema, SlotEventDtoSchema, TrafficSwitchDtoSchema } from '../release';
import { ReleaseJourneyEventSchema, ReleaseJourneySnapshotSchema, ReleaseJourneyStageDtoSchema, ReleaseJourneyStatusSchema, ReleaseTargetRevisionSchema } from './values';

export const ReleaseJourneyVerificationSchema = z.object({
  actorUserId: UserIdSchema, at: z.iso.datetime(), targetRevision: ReleaseTargetRevisionSchema, note: z.string().max(500).optional(),
}).strict();
export const ReleaseJourneySummarySchema = z.object({
  recordKind: z.literal('journey'), id: ResourceIdSchema, snapshot: ReleaseJourneySnapshotSchema,
  revision: z.number().int().nonnegative(), status: ReleaseJourneyStatusSchema, updatedAt: z.iso.datetime(),
}).strict();
export const LegacyReleaseJourneySchema = z.object({
  recordKind: z.literal('legacy'), release: ReleaseDtoSchema,
  provenance: z.literal('retained-release'), stages: z.array(ReleaseJourneyStageDtoSchema),
}).strict();
export const ReleaseJourneyListItemSchema = z.discriminatedUnion('recordKind', [ReleaseJourneySummarySchema, LegacyReleaseJourneySchema]);
export const ReleaseJourneyPageSchema = z.object({
  items: z.array(ReleaseJourneyListItemSchema).max(50), hasMore: z.boolean(), nextCursor: z.string().max(1024).optional(),
}).strict();
export const ReleaseJourneyDetailSchema = ReleaseJourneySummarySchema.extend({
  events: z.array(ReleaseJourneyEventSchema), stages: z.array(ReleaseJourneyStageDtoSchema),
  verification: ReleaseJourneyVerificationSchema.optional(), trafficSwitch: TrafficSwitchDtoSchema.optional(),
  continuation: z.object({
    canVerify: z.boolean(), canLaunch: z.boolean(), reason: z.string().optional(), targetRevision: ReleaseTargetRevisionSchema.optional(),
    expectedActiveReleaseId: ReleaseIdSchema.nullable(),
  }).strict(),
  release: ReleaseDtoSchema, slots: z.array(SlotDtoSchema).max(2),
}).strict();
export const ReleaseJourneyHistorySchema = z.object({
  journeys: z.array(ReleaseJourneySummarySchema), legacy: LegacyReleaseJourneySchema.optional(),
  trafficSwitches: z.array(TrafficSwitchDtoSchema), slotEvents: z.array(SlotEventDtoSchema),
}).strict();
export type ReleaseJourneyVerification = z.infer<typeof ReleaseJourneyVerificationSchema>;
export type ReleaseJourneySummary = z.infer<typeof ReleaseJourneySummarySchema>;
export type LegacyReleaseJourney = z.infer<typeof LegacyReleaseJourneySchema>;
export type ReleaseJourneyListItem = z.infer<typeof ReleaseJourneyListItemSchema>;
export type ReleaseJourneyPage = z.infer<typeof ReleaseJourneyPageSchema>;
export type ReleaseJourneyDetail = z.infer<typeof ReleaseJourneyDetailSchema>;
export type ReleaseJourneyHistory = z.infer<typeof ReleaseJourneyHistorySchema>;
