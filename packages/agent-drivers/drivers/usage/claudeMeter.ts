// RFC-034 v2 §4 —— Claude Code 计量（stream-json），与 agent-workflow `services/runtime/claudeCode/usage.ts`
// 同算法，并补上 CrewStation 才有的常驻输入流（一进程多轮）。依据：Claude Agent SDK 文档「Track cost and usage」
// （code.claude.com/docs/en/agent-sdk/cost-tracking）：
//  - 一次 API 响应拆成多条共享 message id 的 assistant 事件，按 id 取各桶最大值去重；assistant 上的
//    output_tokens 是 message_start 时的占位值，所以流上的合计只是下界（partial）；
//  - `result.modelUsage` 是含子 Agent、按模型的累计，替换流上的视图；常驻输入流里每轮一个 result，
//    modelUsage 是该进程到此为止的累计（读最新一条，不相加）；`/clear` 等重置（conversation_reset）后
//    从零重新累计，重置前最后一条 result 的值要保留；
//  - 恢复会话时 result 还含恢复的历史累计（2.1.277 起），无法拆出：首个 result 只作基线，首轮按 assistant
//    合计计入（下界），之后各轮用 result 差值；
//  - 崩溃时的 `error_during_execution` 可能全零，全零报告不覆盖已知值。

import type { AgentUsageModel } from '@crewstation/contracts';
import { UsageAccumulator, modelKey, objectOf, tokenCount, type UsageMeter, type UsageMeterInput } from './meter';

interface MessageUsage {
  readonly model: string;
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly output: number;
}

const total = (row: Omit<MessageUsage, 'model'>) => row.input + row.cacheRead + row.cacheWrite + row.output;

function modelUsageRows(value: unknown): AgentUsageModel[] {
  return Object.entries(objectOf(value) ?? {}).flatMap(([name, entry]) => {
    const usage = objectOf(entry);
    const model = modelKey(name);
    return usage && model ? [{
      model,
      input: tokenCount(usage.inputTokens),
      cacheRead: tokenCount(usage.cacheReadInputTokens),
      cacheWrite: tokenCount(usage.cacheCreationInputTokens),
      output: tokenCount(usage.outputTokens),
      reasoning: 0,
    }] : [];
  });
}

/** 累计值相减（恢复会话的基线）；按模型逐桶，不出现负数，差为零的模型不留行。 */
function subtract(later: readonly AgentUsageModel[], base: readonly AgentUsageModel[]): AgentUsageModel[] {
  const before = new Map(base.map((row) => [row.model, row]));
  return later.map((row) => {
    const prior = before.get(row.model);
    const less = (key: 'input' | 'cacheRead' | 'cacheWrite' | 'output') => Math.max(0, row[key] - (prior?.[key] ?? 0));
    return { model: row.model, input: less('input'), cacheRead: less('cacheRead'), cacheWrite: less('cacheWrite'), output: less('output'), reasoning: 0 };
  }).filter((row) => total(row) > 0);
}

export function createClaudeUsageMeter(input: Pick<UsageMeterInput, 'resumed'>): UsageMeter {
  /** 已结束的分段（重置之前）与恢复会话首轮的 assistant 合计。 */
  const settled = new UsageAccumulator();
  let settledPartial = false;
  /** 本分段最近一个 result 之后的 assistant 消息。 */
  let pending = new Map<string, MessageUsage>();
  let baseline: AgentUsageModel[] | null = null;
  let latest: AgentUsageModel[] | null = null;
  let needsBaseline = input.resumed;

  const pendingRows = (): AgentUsageModel[] => [...pending.values()].map((row) => ({ ...row, reasoning: 0 }));
  const segment = (): AgentUsageModel[] => {
    const rows = new UsageAccumulator();
    if (latest) rows.addAll(baseline ? subtract(latest, baseline) : latest);
    rows.addAll(pendingRows());
    return rows.models();
  };

  return {
    observe(event) {
      if (event.type === 'conversation_reset') {
        settled.addAll(segment());
        settledPartial ||= pending.size > 0;
        pending = new Map();
        baseline = latest = null;
        needsBaseline = false;
        return false;
      }
      if (event.type === 'assistant') {
        const message = objectOf(event.message);
        const usage = objectOf(message?.usage);
        const id = typeof message?.id === 'string' ? message.id : null;
        if (!id || !usage) return false;
        const previous = pending.get(id);
        const next: MessageUsage = {
          model: previous?.model || modelKey(message?.model),
          input: Math.max(previous?.input ?? 0, tokenCount(usage.input_tokens)),
          cacheRead: Math.max(previous?.cacheRead ?? 0, tokenCount(usage.cache_read_input_tokens)),
          cacheWrite: Math.max(previous?.cacheWrite ?? 0, tokenCount(usage.cache_creation_input_tokens)),
          output: Math.max(previous?.output ?? 0, tokenCount(usage.output_tokens)),
        };
        // 全零（合成消息等）与重复分片都不改变用量。
        if (!previous && total(next) === 0) return false;
        if (previous && previous.model === next.model && total(previous) === total(next)) return false;
        pending.set(id, next);
        return true;
      }
      if (event.type !== 'result') return false;
      const rows = modelUsageRows(event.modelUsage);
      if (!rows.length) return false;
      if (rows.every((row) => total(row) === 0) && (event.subtype === 'error_during_execution' || pending.size > 0)) return false;
      if (needsBaseline) {
        settled.addAll(pendingRows());
        settledPartial = true;
        baseline = rows;
        needsBaseline = false;
      }
      latest = rows;
      pending = new Map();
      return true;
    },
    snapshot() {
      const rows = new UsageAccumulator();
      rows.addAll(settled.models());
      rows.addAll(segment());
      return rows.snapshot(settledPartial || pending.size > 0 || rows.empty ? 'partial' : 'complete');
    },
  };
}
