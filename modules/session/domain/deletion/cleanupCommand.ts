import type { ProjectId, RunnerCommand, StoredBusinessExecutionDto, StoredDevelopmentUsage, TaskId } from '@crewstation/contracts';
import { RunnerCommandSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';

export interface SessionCleanupOriginal {
  readonly projectId: ProjectId;
  readonly taskId: TaskId;
  readonly development?: Pick<StoredDevelopmentUsage, 'registration' | 'persistedThrough'>;
  readonly business?: Pick<StoredBusinessExecutionDto, 'taskId' | 'receipt' | 'persistedThrough'>;
}
const watermark = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 0) throw precondition('会话清理缺少原持久水位');
  return value;
};

/** Cleanup only stops or drains a previously registered source; it cannot discover or start another execution. */
export function sessionCleanupCommand(raw: unknown, original: SessionCleanupOriginal): RunnerCommand {
  const command = RunnerCommandSchema.parse(structuredClone(raw));
  switch (command.type) {
    case 'stopDevelopmentAgent': case 'developmentUsageInfo': case 'readDevelopmentUsageEvents': case 'ackDevelopmentUsageEvents': {
      const stored = original.development, registration = stored?.registration;
      const key = command.type === 'stopDevelopmentAgent' ? command.admission.key : command.key;
      if (!registration || registration.runtimeTaskId !== original.taskId || registration.identity.projectId !== original.projectId
        || !key || jsonHash(key) !== jsonHash(registration.key))
        throw precondition('会话清理命令不属于原开发数字登记');
      const through = watermark(stored!.persistedThrough);
      if (command.type === 'stopDevelopmentAgent' && (command.podUid !== registration.podUid
        || jsonHash(command.admission.intent.identity) !== jsonHash(registration.identity)
        || command.admission.intent.profileId !== registration.profileId || command.admission.intent.profileRevision !== registration.profileRevision))
        throw precondition('会话清理停止命令不属于原 Pod 与受理身份');
      if (command.type === 'readDevelopmentUsageEvents' && command.after > through || command.type === 'ackDevelopmentUsageEvents' && command.through > through)
        throw precondition('会话清理不能跳过或确认尚未持久复制的开发数字');
      return command;
    }
    case 'getBusinessExecution': case 'cancelBusinessExecution': case 'readBusinessExecutionEvents': case 'ackBusinessExecutionEvents': {
      const stored = original.business;
      if (!stored || stored.taskId !== original.taskId || command.executionId !== stored.receipt.executionId)
        throw precondition('会话清理命令不属于原业务数字登记');
      const through = watermark(stored.persistedThrough);
      if (command.type === 'readBusinessExecutionEvents' && command.after > through || command.type === 'ackBusinessExecutionEvents' && command.through > through)
        throw precondition('会话清理不能跳过或确认尚未持久复制的业务事件');
      if (command.type === 'cancelBusinessExecution' && command.registration) {
        const { attempt, incarnation, payloadDigest } = stored.receipt;
        if (jsonHash(command.registration) !== jsonHash({ attempt, incarnation, payloadDigest })) throw precondition('会话清理不能重新登记另一次原业务受理');
        // The private wire skips ordinary PG registration; the Runner needs this identity for cancel-before-start.
      }
      return command;
    }
    default: throw precondition('会话删除许可只允许停止与排空原数字，不允许启动任务或其他命令');
  }
}
