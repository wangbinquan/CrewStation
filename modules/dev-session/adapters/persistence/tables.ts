import { text, timestamp } from 'drizzle-orm/pg-core';
import { devSessionSchema } from './schema';

export const idleReminders = devSessionSchema.table('idle_reminders', {
  taskId: text('task_id').primaryKey(),
  lastReminderAt: timestamp('last_reminder_at', { withTimezone: true }).notNull(),
});
