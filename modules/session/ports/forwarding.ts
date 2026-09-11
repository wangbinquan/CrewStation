import type { RunnerCommand, TaskId } from '@crewstation/contracts';

/** 把命令转发到持有该任务连接的另一个 cs-session 副本。 */
export interface CommandForwarder {
  forward(replica: string, taskId: TaskId, command: RunnerCommand): Promise<unknown>;
}

export interface SessionSettings {
  /** 本副本可被其他副本访问的地址，如 `http://10.244.0.7:8083`。 */
  readonly selfAddress: string;
  readonly commandTimeoutMs: number;
  /** 超过此时长没有任何帧即视为失联。 */
  readonly runnerStaleMs: number;
  readonly replayLimit: number;
}
