import { text, timestamp } from 'drizzle-orm/pg-core';
import { dataControlSchema } from './schema';

/** 按记录 ID 存的角色口令（I28）：只有密文，解密要平台密钥。 */
export const credentials = dataControlSchema.table('credentials', {
  resourceId: text('resource_id').primaryKey(),
  role: text('role').notNull(),
  secretBox: text('secret_box').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
