import { integer, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { jsonDocument } from '@crewstation/persistence';
import type { ReleaseJourneyEvent } from '@crewstation/contracts';
import type { ReleaseJourney } from '../../../domain/journey/journey';
import { releaseSchema } from '../tables';

export const releaseJourneys = releaseSchema.table('release_journeys', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull(), serviceId: text('service_id').notNull(), releaseId: text('release_id').notNull(),
  kind: text('kind').notNull(), status: text('status').notNull(), revision: integer('revision').notNull(), requestKey: text('request_key'),
  body: jsonDocument('body').$type<ReleaseJourney>().notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex('release_journeys_switch_key').on(t.serviceId, t.requestKey)]);

export const releaseJourneyEvents = releaseSchema.table('release_journey_events', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull(), serviceId: text('service_id').notNull(), releaseId: text('release_id').notNull(),
  journeyId: text('journey_id').notNull(), sequence: integer('sequence').notNull(), transitionKey: text('transition_key').notNull(),
  body: jsonDocument('body').$type<ReleaseJourneyEvent>().notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}, (t) => [uniqueIndex('release_journey_events_key').on(t.journeyId, t.transitionKey), uniqueIndex('release_journey_events_sequence').on(t.journeyId, t.sequence)]);
