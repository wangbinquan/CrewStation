// RFC-034 v2 §4 —— 写入侧：派发前受理一行，运行中原地替换用量，结束一次（与 agent-workflow
// RFC-371 v2 `application/recordCalls.ts` 同一流程）。同一执行的写入在这里串行，晚到的中间快照
// 不会覆盖终态；跨进程由存储层的行锁与「只写运行中的行」保证。

import type { AgentUsageSnapshot, ProjectId } from '@crewstation/contracts';
import type { AgentCallRecorder } from '../api/agentCalls';
import { observationBuiltinProfileId } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { callCostState, modelCost, selectPrice } from '../domain/agentCallPricing';
import type { ObservedUsage } from '../domain/agentCallUsage';
import { finalUsageOf, normalizeObservedUsage, sumBuckets, totalTokens, usageStateOf } from '../domain/agentCallUsage';
import type { AgentCallStore, AgentCallTarget, CallEnd, PricedModelUsage } from '../ports/agentCalls';
import type { PriceStore } from '../ports/observationPricing';

export function createAgentCallRecorder(deps: { readonly store: AgentCallStore; readonly prices: Pick<PriceStore, 'line'>; readonly clock?: () => number }): AgentCallRecorder {
  const clock = deps.clock ?? Date.now;
  const queues = new Map<string, Promise<void>>();
  const key = (target: AgentCallTarget) => target.runtimeTaskId + '\u0000' + target.agentId;

  function enqueue(target: AgentCallTarget, operation: () => Promise<void>): Promise<void> {
    const id = key(target);
    // 队尾从不 reject；调用方仍拿到这次写入自己的结果。
    const next = (queues.get(id) ?? Promise.resolve()).then(operation);
    const release = () => { if (queues.get(id) === settled) queues.delete(id); };
    const settled: Promise<void> = next.then(release, release);
    queues.set(id, settled);
    return next;
  }

  async function priced(profileId: string, startedAt: number, usage: ObservedUsage) {
    const rows = await Promise.all(usage.models.map(async (row) => {
      const price = row.model !== '' ? selectPrice(await deps.prices.line(profileId, row.model), startedAt) : null;
      const cost = modelCost(row, price);
      const state = callCostState([{ tokens: totalTokens(row), cost }]).costState;
      const model: PricedModelUsage = { ...row, priceId: price?.id ?? null, costNano: cost.costNano, costState: state };
      return { model, cost };
    }));
    const total = callCostState(rows.map(({ model, cost }) => ({ tokens: totalTokens(model), cost })));
    return { models: rows.map(({ model }) => model), ...total };
  }

  async function write(target: AgentCallTarget, observed: AgentUsageSnapshot | ObservedUsage, end?: CallEnd): Promise<void> {
    const context = await deps.store.running(target);
    if (!context) return;
    const normalized = normalizeObservedUsage(observed), usage = end ? finalUsageOf(normalized, end.status) : normalized;
    const { models, costNano, costState } = await priced(context.profileId, context.startedAt, usage);
    await deps.store.writeUsage(context.id, {
      usageState: usageStateOf(usage, end !== undefined), totals: sumBuckets(usage.models), costNano, costState, models,
      updatedAt: clock(), ...(end ? { end } : {}),
    });
  }

  return {
    async accept(start) {
      const id = start.id ?? newResourceId();
      const { profile, startedAt, id: _id, ...identity } = start;
      await deps.store.insert({
        ...identity, id, projectId: identity.projectId as ProjectId | null,
        profileId: profile?.id ?? observationBuiltinProfileId(start.protocol), profileRevision: profile?.revision ?? null, profileName: profile?.name ?? null,
        startedAt: (startedAt ?? new Date(clock())).getTime(),
      }, clock());
      return id;
    },
    usage: (target, snapshot) => enqueue(target, () => write(target, snapshot)),
    finish(target, outcome) {
      const end: CallEnd = { status: outcome.status, endedAt: outcome.at.getTime() };
      return enqueue(target, async () => {
        if (outcome.snapshot) return write(target, outcome.snapshot, end);
        const context = await deps.store.running(target);
        if (context) await deps.store.end(context.id, end, clock());
      });
    },
    closeRuntimeTask: (runtimeTaskId, at) => deps.store.endRuntimeTask(runtimeTaskId, { status: 'interrupted', endedAt: at.getTime() }, clock()),
  };
}
