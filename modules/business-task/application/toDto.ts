import type { BusinessTaskDto, SubtaskDto } from '@crewstation/contracts';
import type { BusinessTask } from '../domain/businessTask';
import type { SubtaskRun } from '../domain/subtaskRun';

export function taskToDto(task: BusinessTask, podName?: string): BusinessTaskDto {
  return {
    id: task.id, serviceId: task.serviceId, state: task.state, traceId: task.traceId, volumeMode: task.volumeMode, profile: task.profile,
    ...(podName ? { podName } : {}), labels: task.labels, createdAt: task.createdAt.toISOString(), ...(task.closedAt ? { closedAt: task.closedAt.toISOString() } : {}), ...(task.message ? { message: task.message } : {}),
  };
}

export function subtaskToDto(run: SubtaskRun): SubtaskDto {
  return {
    id: run.id, taskId: run.taskId, name: run.name, kind: run.kind, ...(run.mode ? { mode: run.mode } : {}), state: run.state, attempt: run.attempt,
    ...(run.agentProfile ? { agentProfile: run.agentProfile.name } : {}), ...(run.outputContract ? { outputContract: run.outputContract.name } : {}),
    ...(run.businessOutcome ? { businessOutcome: run.businessOutcome } : {}), ...(run.sessionId ? { sessionId: run.sessionId } : {}),
    ...(run.exitCode !== undefined ? { exitCode: run.exitCode } : {}), ...(run.contractResult ? { contractResult: run.contractResult } : {}), ...(run.runtime ? { runtime: run.runtime } : {}),
    ...(run.startedAt ? { startedAt: run.startedAt.toISOString() } : {}), ...(run.endedAt ? { endedAt: run.endedAt.toISOString() } : {}), ...(run.error ? { error: run.error } : {}),
  };
}
