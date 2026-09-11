import { boolean, text, timestamp } from 'drizzle-orm/pg-core';
import { identitySchema } from './schema';

export const users = identitySchema.table('users', {
  id: text('id').primaryKey(),
  externalId: text('external_id').notNull().unique(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  isAdmin: boolean('is_admin').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }).notNull(),
});
