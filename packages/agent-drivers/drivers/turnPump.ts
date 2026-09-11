// 一次进程拉起的输出泵：stdout 逐行解析 → 归一事件 → AgentEvent；stderr 进有界尾部。
// ← agent-workflow `execution/managedProcess.ts` 的流泵与排水段，去掉 Windows spool、
// 预激活 launcher、PID 收据与行截断回调（行上限由宿主 streamPump.ts 负责）。

import type { AgentEvent, AgentEventType } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import type { DriverChildProcess, ProcessHost } from '../contract/processHost';
import type { NormalizedEvent } from '../contract/normalizedEvent';
import { createBoundedTail } from '../process/boundedTail';
import type { AgentEventFields, TokenUsage } from './agentEventMapping';
import { accumulateTokens, toAgentEvent } from './agentEventMapping';

/** 进程退出后等待管道读尽的上限；到期仍被孙进程占着就杀掉残余进程组。 */
export const DRAIN_GRACE_MS = 2000;

export interface TurnPumpDeps {
  host: ProcessHost;
  logger: Logger;
  usage: TokenUsage;
  emit: (type: AgentEventType, fields?: AgentEventFields, at?: number) => AgentEvent;
  push: (event: AgentEvent) => void;
  parseEvent: (line: string) => NormalizedEvent | null;
  /** 捕获到原生会话 id 时回调（第一次出现即申领，之后变化也如实上报）。 */
  onSessionId: (sessionId: string) => void;
  /** 观察到终止事件（Claude 的 result／opencode 的 step_finish）时回调。 */
  onTurnFinished: (terminalError: string | null) => void;
}

export interface TurnPumpResult {
  exitCode: number | null;
  signalCode: string | null;
  stderrTail: string;
  drained: boolean;
}

/** 泵完一个子进程的两条流并等它退出。 */
export async function pumpTurn(child: DriverChildProcess, deps: TurnPumpDeps): Promise<TurnPumpResult> {
  const tail = createBoundedTail();
  const pumps = Promise.all([
    deps.host.pumpLines(child.stdout, (line) => handleStdoutLine(line, deps)),
    deps.host.pumpLines(child.stderr, (line) => {
      tail.append(`${line}\n`);
      // stderr 不进事件流：它多是 CLI 的诊断噪声，失败时整段尾部会随 error 事件一起给出。
      deps.logger.debug('agent stderr', { line });
    }),
  ]);
  await child.exited;
  const drained = await Promise.race([pumps.then(() => true), Bun.sleep(DRAIN_GRACE_MS).then(() => false)]);
  if (!drained) await deps.host.killTree(child, 0);
  return { exitCode: child.exitCode, signalCode: child.signalCode, stderrTail: tail.text, drained };
}

function handleStdoutLine(line: string, deps: TurnPumpDeps): void {
  if (line.length === 0) return;
  const event = deps.parseEvent(line);
  if (event === null) {
    // 非 JSON 行按原样文本呈现：CLI 偶尔会在 stdout 上写非协议输出，丢掉等于丢诊断。
    deps.push(deps.emit('text', { text: line }));
    return;
  }
  accumulateTokens(deps.usage, event);
  if (event.sessionId !== undefined) deps.onSessionId(event.sessionId);
  const mapped = toAgentEvent(event, deps.emit);
  if (mapped !== null) deps.push(mapped);
  if (event.kind === 'step_finish') {
    const terminalError = event.terminalError?.isError === true
      ? (event.terminalError.message.length > 0 ? event.terminalError.message : 'claude 报告了终止错误结果')
      : null;
    deps.onTurnFinished(terminalError);
  }
}
