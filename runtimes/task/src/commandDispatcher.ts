import type { RunnerCommand } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import { toCommandError } from './commandError';

export type CommandType = RunnerCommand['type'];
export type CommandOf<K extends CommandType> = Extract<RunnerCommand, { type: K }>;
/** 每种命令一个处理器；返回值即 `result.payload`（无内容的命令返回 `{}`）。 */
export type CommandHandlers = { [K in CommandType]: (command: CommandOf<K>) => Promise<unknown> };

export interface ReplyPort {
  reply(id: string, payload: unknown): void;
  fail(id: string, code: string, message: string): void;
}

export interface CommandDispatcher {
  /** 并发执行：一个慢命令（verifyContract、exec）不阻塞其他命令。 */
  dispatch(command: RunnerCommand): Promise<void>;
  /** 开始排空：之后到达的命令一律回 `runner_draining`。 */
  refuseNew(): void;
  /** 等待在途命令结束（调用方负责用 grace 期限兜底）。 */
  drain(): Promise<void>;
  readonly inFlight: number;
}

export function createCommandDispatcher(handlers: CommandHandlers, port: ReplyPort, logger: Logger): CommandDispatcher {
  const inFlight = new Set<Promise<void>>();
  let refusing = false;
  const run = async (command: RunnerCommand): Promise<void> => {
    const startedAt = Date.now();
    try {
      const handler = handlers[command.type] as (input: RunnerCommand) => Promise<unknown>;
      const payload = await handler(command);
      port.reply(command.id, payload ?? {});
      logger.debug('command done', { id: command.id, type: command.type, durationMs: Date.now() - startedAt });
    } catch (error) {
      const failure = toCommandError(error);
      port.fail(command.id, failure.code, failure.message);
      logger.warn('command failed', { id: command.id, type: command.type, code: failure.code, message: failure.message });
    }
  };
  return {
    dispatch(command) {
      if (refusing) {
        port.fail(command.id, 'runner_draining', 'TaskRunner 正在关闭，不再接受命令');
        return Promise.resolve();
      }
      const promise = run(command).finally(() => inFlight.delete(promise));
      inFlight.add(promise);
      return promise;
    },
    refuseNew() {
      refusing = true;
    },
    async drain() {
      await Promise.allSettled([...inFlight]);
    },
    get inFlight() {
      return inFlight.size;
    },
  };
}
