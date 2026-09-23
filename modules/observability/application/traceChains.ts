import type { Actor, ProjectId, TaskId, TraceChainDto, TraceEventDto, TraceEventsQuery, TraceListQuery, TraceSummaryDto } from '@crewstation/contracts';
import type { Clock } from '@crewstation/kernel';
import { notFound } from '@crewstation/kernel';
import { assembleChain, groupTraceParts, summarizeTrace } from '../domain/traceAssembly';
import { toTraceEvent, TRACE_EVENT_KINDS } from '../domain/traceEvents';
import type { TracePosition } from '../domain/tracePaging';
import { compareTracePositions, decodeTraceCursor, encodeTraceCursor, scannedFloor, windowStart, withinScannedRange } from '../domain/tracePaging';
import type { ProjectAuthorizer } from '../ports/sources';
import type { TraceChainSources } from '../ports/traceSources';

export interface TraceChainDeps {
  readonly authorizer: ProjectAuthorizer;
  readonly chains: TraceChainSources;
  readonly clock: Clock;
}

export interface Page<T> { readonly items: T[]; readonly nextCursor?: string }

/** 「全部」时间范围下，一次请求最多扫这么多轮；筛选条件很窄时先返回已找到的，并给出继续往前找的游标。 */
const MAX_SCAN_ROUNDS = 6;

const positionOf = (row: TraceSummaryDto): TracePosition => ({ at: row.startedAt, traceId: row.traceId });
const byPosition = (a: TraceSummaryDto, b: TraceSummaryDto) => compareTracePositions(positionOf(a), positionOf(b));
const matches = (query: TraceListQuery) => (row: TraceSummaryDto) => (!query.source || row.sources.includes(query.source)) && (!query.status || row.status === query.status);

/**
 * 调用链（Design §14；2026-09-23 作者裁定）：本项目的全部链按开始时间倒序列出，可按来源、状态、有活动的时间范围筛选；
 * 一条链的分层回放；一个 Agent 执行的事件分页。每一步都只取本项目的记录——同一个 traceId 在别的订阅项目里的部分不带出来。
 */
export function traceChainUseCases(deps: TraceChainDeps) {
  const { chains } = deps;

  const summaries = async (projectId: ProjectId, traceIds: string[]): Promise<TraceSummaryDto[]> => {
    if (traceIds.length === 0) return [];
    const [environments, deliveries, businessTasks] = await Promise.all([
      chains.environments.list(projectId, traceIds), chains.deliveries.list(projectId, traceIds), chains.businessTasks.list(projectId, traceIds),
    ]);
    return [...groupTraceParts({ environments, deliveries, businessTasks })].flatMap(([traceId, parts]) => { const row = summarizeTrace(traceId, parts); return row ? [row] : []; });
  };

  /** 「全部」：两个来源各按自己的开始时间倒序给一批，合并后只收下界以内的，不够一页就从下界接着扫。 */
  const scan = async (projectId: ProjectId, query: TraceListQuery): Promise<Page<TraceSummaryDto>> => {
    const batch = Math.max(query.limit, 20), items: TraceSummaryDto[] = [];
    let cursor = query.cursor ? decodeTraceCursor(query.cursor) : undefined;
    for (let round = 0; round < MAX_SCAN_ROUNDS; round++) {
      const page = { ...(cursor ? { before: cursor } : {}), limit: batch };
      const batches = await Promise.all([chains.environments.traceKeys(projectId, page), chains.deliveries.traceKeys(projectId, page)]);
      const floor = scannedFloor(batches, batch), range = cursor;
      const rows = (await summaries(projectId, [...new Set(batches.flat().map((k) => k.traceId))]))
        .filter((row) => withinScannedRange(positionOf(row), range, floor)).filter(matches(query)).sort(byPosition);
      for (const row of rows) {
        items.push(row);
        if (items.length === query.limit) return { items, nextCursor: encodeTraceCursor(positionOf(row)) };
      }
      if (!floor) return { items };
      cursor = floor;
    }
    return { items, ...(cursor ? { nextCursor: encodeTraceCursor(cursor) } : {}) };
  };

  /** 有时间范围（或只看进行中）：先取出范围内有活动的全部链，再排序分页。 */
  const windowed = async (projectId: ProjectId, query: TraceListQuery, since: string): Promise<Page<TraceSummaryDto>> => {
    const ids = await Promise.all([chains.environments.activeTraceIds(projectId, since), chains.deliveries.activeTraceIds(projectId, since)]);
    const rows = (await summaries(projectId, [...new Set(ids.flat())])).filter(matches(query)).sort(byPosition);
    const cursor = query.cursor ? decodeTraceCursor(query.cursor) : undefined;
    const after = cursor ? rows.filter((row) => compareTracePositions(positionOf(row), cursor) > 0) : rows;
    const items = after.slice(0, query.limit), last = items.at(-1);
    return { items, ...(after.length > query.limit && last ? { nextCursor: encodeTraceCursor(positionOf(last)) } : {}) };
  };

  return {
    listTraces: async (actor: Actor, projectId: ProjectId, query: TraceListQuery): Promise<Page<TraceSummaryDto>> => {
      await deps.authorizer.authorize(actor, projectId, 'view');
      const now = deps.clock.now();
      // 只看进行中时，仍在进行的链不论开始多早都要列出来：按「此刻仍有活动」取。
      const since = windowStart(query.window, now) ?? (query.status === 'running' ? now.toISOString() : undefined);
      return since ? windowed(projectId, query, since) : scan(projectId, query);
    },

    getTraceChain: async (actor: Actor, projectId: ProjectId, traceId: string): Promise<TraceChainDto> => {
      await deps.authorizer.authorize(actor, projectId, 'view');
      const [environments, deliveries, businessTasks] = await Promise.all([
        chains.environments.list(projectId, [traceId]), chains.deliveries.list(projectId, [traceId]), chains.businessTasks.list(projectId, [traceId]),
      ]);
      const executions = environments.filter((e) => e.native).map((e) => e.id);
      const counted = executions.length === 0 ? [] : await chains.sessions.summarize(executions, TRACE_EVENT_KINDS);
      const chain = assembleChain(traceId, { environments, deliveries, businessTasks }, new Map(counted.map((s) => [s.taskId, s])));
      if (!chain) throw notFound('本项目的调用链', traceId);
      return chain;
    },

    listTraceEvents: async (actor: Actor, projectId: ProjectId, traceId: string, taskId: TaskId, query: TraceEventsQuery): Promise<Page<TraceEventDto>> => {
      await deps.authorizer.authorize(actor, projectId, 'view');
      const environments = await chains.environments.list(projectId, [traceId]);
      if (!environments.some((e) => e.id === taskId)) throw notFound('这条调用链里的执行', taskId);
      const rows = await chains.sessions.events(taskId, { afterSeq: query.cursor ? Number(query.cursor) : 0, limit: query.limit + 1, kinds: TRACE_EVENT_KINDS });
      const page = rows.slice(0, query.limit), last = page.at(-1);
      const items = page.flatMap((row) => { const event = toTraceEvent(row); return event ? [event] : []; });
      return { items, ...(rows.length > query.limit && last ? { nextCursor: String(last.seq) } : {}) };
    },
  };
}
