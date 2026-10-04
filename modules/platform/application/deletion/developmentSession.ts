import { DEVELOPMENT_USAGE_LIMITS } from '@crewstation/contracts';
import type { ProjectDeletionContext, TaskId } from '@crewstation/contracts';
import type { SessionCleanupBinding } from '../../ports/sessionCleanup';
import { newResourceId, precondition } from '@crewstation/kernel';

interface OriginalContext {
  projectDeletionParticipantContext(context: ProjectDeletionContext, participant: 'session'): Promise<ProjectDeletionContext>;
}
/** Original owner ending uses the private Session port after ordinary producers and consumers have been fenced. */
export function developmentDeletionSession(project: OriginalContext, bind: SessionCleanupBinding) {
  return async (context: ProjectDeletionContext, taskId: TaskId) => {
    const sessionContext = await project.projectDeletionParticipantContext(context, 'session'), session = bind(sessionContext, taskId);
    return { ...session, sendCommand: async (id: TaskId, command: Parameters<typeof session.send>[1]) => {
      if (id !== taskId) throw precondition('开发停止通道只能使用原任务');
      const transports = await session.transports();
      if (transports.length !== 1) throw precondition('原开发连接尚未唯一确定，等待原连接退出或恢复证明');
      const original = transports[0]!;
      // Reusing the ending job's fixed command id can replay a cached "stopping" reply forever.
      const observed = command.type === 'stopDevelopmentAgent' ? { ...command, id: newResourceId() } : command;
      const reply = await session.send(original, observed);
      if (command.type !== 'stopDevelopmentAgent') return reply;
      const found = await session.lookupDevelopmentUsage(taskId);
      if (found.kind !== 'registered') throw precondition('原开发执行没有独立数字登记');
      const key = found.stored.registration.key;
      await session.send(original, { id: newResourceId(), type: 'developmentUsageInfo', key });
      const before = await session.getDevelopmentUsage(taskId, key);
      if (before.receipt && before.persistedThrough < before.receipt.lastSequence)
        await session.send(original, { id: newResourceId(), type: 'readDevelopmentUsageEvents', key, after: before.persistedThrough, limit: DEVELOPMENT_USAGE_LIMITS.capturesPerPage });
      const copied = await session.getDevelopmentUsage(taskId, key);
      if (copied.runnerAcknowledgedThrough < copied.persistedThrough)
        await session.send(original, { id: newResourceId(), type: 'ackDevelopmentUsageEvents', key, through: copied.persistedThrough });
      return reply;
    } };
  };
}
