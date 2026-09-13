import { z } from 'zod';
import { FullCommitShaSchema, HealthDtoSchema, SlotDtoSchema } from '@crewstation/contracts';
import type { Clock } from '@crewstation/kernel';

export const SummarySlotsSchema = z.array(SlotDtoSchema).max(2).superRefine((slots, context) => {
  const names = new Set<string>();
  for (const [i, slot] of slots.entries()) {
    if (names.has(slot.name) || slot.active !== (slot.name === 'prod') ||
      (slot.state === 'empty' ? !!(slot.releaseId || slot.tag || slot.commitSha) : !slot.releaseId || !slot.tag || !FullCommitShaSchema.safeParse(slot.commitSha).success)) {
      context.addIssue({ code: 'custom', path: [i], message: 'inconsistent slot' });
    }
    names.add(slot.name);
  }
  if (slots.length === 1) context.addIssue({ code: 'custom', message: 'incomplete slots' });
});
export const SummaryHealthSchema = z.array(HealthDtoSchema).min(1).max(2).refine((rows) => new Set(rows.map((r) => r.slot)).size === rows.length);
export const unavailablePart = (clock: Clock, reason: 'unavailable' | 'invalid' | 'timeout' | 'not-provided' = 'timeout') =>
  ({ status: 'unknown', reason, checkedAt: clock.now().toISOString() } as const);

export async function readPart<T extends z.ZodType>(schema: T, read: () => Promise<unknown>, clock: Clock) {
  try {
    const result = schema.safeParse(await read());
    return result.success ? { status: 'ready' as const, value: result.data, checkedAt: clock.now().toISOString() } : unavailablePart(clock, 'invalid');
  } catch { return unavailablePart(clock, 'unavailable'); }
}

/** 同一页最多四个在途来源读取。截止后不启动后续读取，也不以超时释放名额后继续扇出。 */
export async function runSummaryReads(jobs: Array<() => Promise<void>>, budgetMs: number): Promise<void> {
  let next = 0, stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
  const worker = async () => {
    while (!stopped && next < jobs.length) { const job = jobs[next++]!; await job(); }
  };
  try {
    await Promise.race([
      Promise.all(Array.from({ length: Math.min(4, jobs.length) }, worker)),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, budgetMs); }),
    ]);
  } finally { stopped = true; clearTimeout(timer); }
}
