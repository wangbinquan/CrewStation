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

/** 签名密钥环：整库一行，material 是 @crewstation/jwt 的序列化形态（含私钥，只在此表出现）。 */
export const signingKeys = identitySchema.table('signing_keys', {
  name: text('name').primaryKey(),
  material: text('material').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
