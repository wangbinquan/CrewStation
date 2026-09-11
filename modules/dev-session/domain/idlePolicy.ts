/** 空闲只提醒不自动释放（G19）：超过阈值且距上次提醒也超过阈值时再提醒一次。 */
export function shouldRemind(lastActivityAt: Date, lastReminderAt: Date | undefined, now: Date, idleMinutes: number): boolean {
  const idleMs = idleMinutes * 60_000;
  if (now.getTime() - lastActivityAt.getTime() < idleMs) return false;
  return !lastReminderAt || now.getTime() - lastReminderAt.getTime() >= idleMs;
}
