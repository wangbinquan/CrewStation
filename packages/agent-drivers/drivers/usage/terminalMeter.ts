// RFC-034 v2 §4 ——「＋ CLI」终端（原生 TUI）没有结构化输出，按协议从原生来源得到本次执行的快照：
//  - OpenCode：只读汇总私有原生存储（opencodeStore.ts）。活动通道报告了根会话时只汇总这些会话树，
//    否则汇总执行开始以来活跃的全部会话（终端的 HOME 是每次执行私有的）；
//  - Claude Code：累加已接入的 OTel 日志里的 `api_request`（每次模型请求一条，含子 Agent，输出为最终值），
//    按（会话, 事件序号）去重以吸收导出重试。
// 通道有缺口时快照标为 partial（已知下界）。

import type { AgentUsageSnapshot, KnownAgentProtocol } from '@crewstation/contracts';
import type { ClaudeApiRequest } from '../claudeCode/nativeTelemetry';
import { UsageAccumulator } from './meter';
import { opencodeUsageDatabasePath, readOpencodeStoreUsage, readOpencodeTreeUsage } from './opencodeStore';

/** 去重键的上限：超过后不再记新键（极长会话里重复导出的概率可以忽略）。 */
const MAX_REQUEST_KEYS = 200_000;

export interface TerminalUsageMeter {
  /** OpenCode 活动通道报告的会话；`parentId` 为 null 即根会话。 */
  observeSession(sessionId: string, parentId: string | null): void;
  /** Claude 遥测里的一次模型请求；用量变化时返回 true。 */
  observeRequest(request: ClaudeApiRequest): boolean;
  /** 来源出现缺口：此后的快照只是下界。 */
  degrade(): void;
  /** 当前快照；OpenCode 每次读一次原生存储，读不到返回 null（保留上一份）。 */
  read(): AgentUsageSnapshot | null;
}

export function createTerminalUsageMeter(protocol: KnownAgentProtocol, env: Readonly<Record<string, string | undefined>>, startedAt: number): TerminalUsageMeter {
  const roots = new Set<string>();
  const seen = new Set<string>();
  const requests = new UsageAccumulator();
  let degraded = false;
  const state = (): AgentUsageSnapshot['state'] => (degraded ? 'partial' : 'complete');
  return {
    observeSession(sessionId, parentId) {
      if (parentId === null) roots.add(sessionId);
    },
    observeRequest(request) {
      if (request.sequence !== null) {
        const key = `${request.sessionId}:${request.sequence}`;
        if (seen.has(key)) return false;
        if (seen.size < MAX_REQUEST_KEYS) seen.add(key);
      }
      if (request.input + request.output + request.cacheRead + request.cacheWrite === 0) return false;
      requests.add(request.model, { input: request.input, cacheRead: request.cacheRead, cacheWrite: request.cacheWrite, output: request.output, reasoning: 0 });
      return true;
    },
    degrade() {
      degraded = true;
    },
    read() {
      if (protocol === 'claude-code') return requests.snapshot(state());
      const path = opencodeUsageDatabasePath(env);
      const models = roots.size > 0 ? readOpencodeTreeUsage(path, [...roots], startedAt)?.models ?? null : readOpencodeStoreUsage(path, startedAt);
      return models ? { state: state(), models: models.slice(0, 100) } : null;
    },
  };
}
