import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

/** Ordinary pollers must not select a sealed project and then fail its whole shared batch. */
export const ordinarySessionTask = (task: SQL) => sql`NOT EXISTS(SELECT 1 FROM session.task_origins origin
  JOIN session.project_deletions deletion ON deletion.project_id=origin.project_id WHERE origin.task_key=${task})`;
