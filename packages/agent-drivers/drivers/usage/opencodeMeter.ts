// RFC-034 v2 §4 —— OpenCode 计量，与 agent-workflow `services/runtime/opencode/usage.ts` 同算法。
//
// `opencode run --format json` 只把根会话的 part 写到 stdout（opencode
// `packages/opencode/src/cli/cmd/run.ts:678-692` 的 emit，`:717` 跳过其他会话，`:744-746` 发 step_finish，
// `:719-720` 在工具完成时发 tool_use），所以流上只有根会话的步骤用量；委派的子 Agent（`task` 工具）在子会话里跑。
// 每轮进程排空后对原生存储做一次有界只读汇总（opencodeStore.ts），换成含子 Agent、按实际模型分组的结果。
// CrewStation 的交互式 OpenCode 是「一轮一进程 + `--session` 续接」，一次执行跨多轮：汇总始终覆盖
// 执行开始以来的全部步骤，汇总之后的新步骤先按流累加，直到下一次汇总替换。

import type { AgentUsageModel } from '@crewstation/contracts';
import { UsageAccumulator, combineUsage, objectOf, tokenCount, type UsageMeter, type UsageMeterInput } from './meter';
import { opencodeUsageDatabasePath, readOpencodeTreeUsage } from './opencodeStore';

export function createOpencodeUsageMeter(input: UsageMeterInput): UsageMeter {
  const stream = new UsageAccumulator();
  const steps = new Set<string>();
  const roots = new Set<string>();
  // step_finish 不带模型：流上的步骤先记在档位配置的模型下，汇总后换成实际模型。
  const model = input.configuredModel ?? '';
  let summary: readonly AgentUsageModel[] = [];
  /** 上次汇总之后见到了子 Agent：其用量只在原生存储里。 */
  let delegated = false;
  return {
    observe(event) {
      if (typeof event.sessionID === 'string' && event.sessionID) roots.add(event.sessionID);
      const part = objectOf(event.part);
      if (event.type === 'tool_use') {
        if (part?.tool !== 'task' || delegated) return false;
        delegated = true;
        return true;
      }
      if (event.type !== 'step_finish') return false;
      const id = typeof part?.id === 'string' ? part.id : null;
      if (id !== null) {
        if (steps.has(id)) return false;
        steps.add(id);
      }
      const tokens = objectOf(part?.tokens);
      const cache = objectOf(tokens?.cache);
      const reasoning = tokenCount(tokens?.reasoning);
      // OpenCode 的 output 不含推理（opencode `packages/opencode/src/session/session.ts:338-374` 的 getUsage 扣除），加回一次。
      stream.add(model, {
        input: tokenCount(tokens?.input),
        cacheRead: tokenCount(cache?.read),
        cacheWrite: tokenCount(cache?.write),
        output: tokenCount(tokens?.output) + reasoning,
        reasoning,
      });
      return true;
    },
    snapshot: () => combineUsage(summary, stream.models(), delegated ? 'partial' : 'complete'),
    refresh() {
      if (roots.size === 0) return false;
      const tree = readOpencodeTreeUsage(opencodeUsageDatabasePath(input.env), [...roots], input.startedAt);
      // 存储里的根步骤少于流上已见的：不是本次执行的存储或尚未落盘，保留流上的视图。
      if (!tree || tree.rootSteps < steps.size) return false;
      summary = tree.models;
      stream.clear();
      delegated = false;
      return true;
    },
  };
}
