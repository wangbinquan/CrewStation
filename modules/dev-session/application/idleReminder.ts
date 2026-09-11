import type { TaskId, UserId } from '@crewstation/contracts';
import { shouldRemind } from '../domain/idlePolicy';
import type { DevSessionUseCaseDeps } from './dependencies';

/** 空闲提醒：给开发者与负责人各发一次，不自动释放；负责人可强制释放（G19、AT-55）。 */
export function idleReminderUseCase(deps: DevSessionUseCaseDeps) {
  return async (): Promise<number> => {
    const now = deps.clock.now();
    let sent = 0;
    for (const env of await deps.environments.listRunningDevSessions()) {
      const last = await deps.reminders.lastReminder(env.id);
      if (!shouldRemind(new Date(env.lastActivityAt), last, now, deps.settings.idleMinutes)) continue;
      const owner = await deps.authorizer.ownerOf(env.projectId);
      const creator = (env as { createdBy?: UserId }).createdBy;
      const recipients = [...new Set([owner, creator].filter((u): u is UserId => Boolean(u)))];
      const idleMinutes = Math.round((now.getTime() - new Date(env.lastActivityAt).getTime()) / 60_000);
      await deps.notifier.notify(env.projectId, recipients, `开发会话已空闲 ${idleMinutes} 分钟（分支 ${env.branch ?? '?'}）。平台不会自动释放；请在确认没有未推送内容后手动释放。`, { taskId: env.id as TaskId });
      await deps.reminders.recordReminder(env.id, now);
      sent += 1;
    }
    return sent;
  };
}
