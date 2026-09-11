import type { Actor, ProjectId, SubtaskId, TraceId, TraceReplayDto } from '@crewstation/contracts';
import type { ObservabilityUseCaseDeps } from './dependencies';

/** traceId 回放（R24、AT-44）：任务 → 子任务 → Agent 会话与事件；前台触发时带 otel_trace_id 由调用方写入事件。 */
export function traceReplayUseCase(deps: ObservabilityUseCaseDeps) {
  return async (actor: Actor, projectId: ProjectId, traceId: TraceId): Promise<TraceReplayDto> => {
    await deps.authorizer.authorize(actor, projectId, 'view');
    const tasks = await deps.traces.tasksByTrace(traceId);
    const subtasks: TraceReplayDto['subtasks'] = [];
    const events: TraceReplayDto['events'] = [];
    const sessionIds = new Set<string>();
    for (const task of tasks) {
      for (const s of await deps.traces.subtasksOfTask(task.taskId)) {
        subtasks.push({ subtaskId: s.id as SubtaskId, taskId: task.taskId, name: s.name, state: s.state, ...(s.sessionId ? { sessionId: s.sessionId } : {}) });
        if (s.sessionId) sessionIds.add(s.sessionId);
      }
      for (const e of await deps.traces.sessionEvents(task.taskId)) {
        const agent = e.event.event;
        if (agent?.sessionId) sessionIds.add(agent.sessionId);
        events.push({ at: e.at, type: `${e.event.kind}${agent?.type ? `.${agent.type}` : ''}`, taskId: task.taskId, ...(agent?.sessionId ? { sessionId: agent.sessionId } : {}), ...(agent?.text ? { summary: agent.text.slice(0, 200) } : {}) });
      }
    }
    return { traceId, tasks, subtasks, sessionIds: [...sessionIds], events };
  };
}
