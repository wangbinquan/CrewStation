import type { Actor, RunnerCommand, TaskId } from '@crewstation/contracts';
import { RunnerCommandSchema } from '@crewstation/contracts';
import { forbidden, isPlatformError } from '@crewstation/kernel';
import type { EventSink } from '../domain/runnerConnection';
import { openBrowserReplay } from './browserReplay';
import type { BrowserReplayOptions } from './browserReplay';
import type { commandDispatch } from './commandDispatch';
import type { SessionUseCaseDeps } from './dependencies';
import type { RunnerHub } from './runnerHub';
import { terminalViewCommand } from '../domain/terminalViews';

export interface BrowserStream {
  /** 浏览器发来的命令帧：校验后派发，结果按 id 回给该浏览器。 */
  onMessage(raw: unknown): Promise<void>;
  close(): void;
}

/** 浏览器（工作台）到某任务的流：先回放持久事件到 sinceSeq 之后，再接实时广播；命令经同一派发口。 */
export function browserStreams(deps: SessionUseCaseDeps, hub: RunnerHub, dispatch: ReturnType<typeof commandDispatch>) {
  return {
    open: async (actor: Actor, taskId: TaskId, sink: EventSink, sinceSeq: number, options: BrowserReplayOptions = {}): Promise<BrowserStream> => {
      if (!(await deps.taskAccess.canOpenStream(actor, taskId))) throw forbidden('无权访问该任务的会话流');
      const { complete, unsubscribe } = await openBrowserReplay(deps, hub, taskId, sink, sinceSeq, options);
      const viewId = crypto.randomUUID();
      const controlled = new Set<string>();
      return {
        onMessage: async (raw) => {
          const parsed = RunnerCommandSchema.safeParse(raw);
          if (!parsed.success) { sink.send(JSON.stringify({ type: 'error', id: (raw as { id?: string })?.id ?? '', code: 'validation', message: '命令帧不合法' })); return; }
          const command: RunnerCommand = parsed.data;
          if (!complete) { sink.send(JSON.stringify({ type: 'error', id: command.id, code: 'replay_pending', message: '历史事件尚未补齐，请等待连接就绪' })); return; }
          try {
            const scoped = terminalViewCommand(command, viewId);
            if (scoped.type === 'claimTerminalControl') controlled.add(scoped.terminalId);
            const payload = await dispatch.sendCommand(taskId, scoped);
            if (scoped.type === 'detachTerminal') controlled.delete(scoped.terminalId);
            sink.send(JSON.stringify({ type: 'result', id: command.id, payload }));
          } catch (error) {
            sink.send(JSON.stringify({ type: 'error', id: command.id, code: isPlatformError(error) ? error.kind : 'internal', message: isPlatformError(error) ? error.message : '内部错误' }));
          }
        },
        close: () => {
          unsubscribe();
          for (const terminalId of controlled) void dispatch.sendCommand(taskId, { id: crypto.randomUUID(), type: 'detachTerminal', terminalId, viewId }).catch(() => undefined);
        },
      };
    },
  };
}
