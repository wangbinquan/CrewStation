import type { Executor } from '@crewstation/persistence';
import { eq } from 'drizzle-orm';
import type { ReminderRepository } from '../../ports/runtime';
import { idleReminders } from './tables';

export function drizzleReminderRepository(db: Executor): ReminderRepository {
  return {
    lastReminder: async (taskId) => (await db.select().from(idleReminders).where(eq(idleReminders.taskId, taskId)))[0]?.lastReminderAt,
    recordReminder: async (taskId, at) => {
      await db.insert(idleReminders).values({ taskId, lastReminderAt: at }).onConflictDoUpdate({ target: idleReminders.taskId, set: { lastReminderAt: at } });
    },
  };
}
