import { integer, text, timestamp, index } from 'drizzle-orm/pg-core';
import { identitySchema } from '../schema';
export const developerAccessRequests = identitySchema.table('developer_access_requests', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), reason: text('reason').notNull(), state: text('state').notNull(), revision: integer('revision').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(), reviewedAt: timestamp('reviewed_at', { withTimezone: true }), reviewerId: text('reviewer_id'), note: text('note'),
}, table => [index('developer_access_user_idx').on(table.userId, table.id), index('developer_access_state_idx').on(table.state, table.id)]);
