import { describe, expect, test } from 'bun:test';
import { TraceChainDtoSchema, TraceEventPageSchema, TraceEventsQuerySchema, TraceListQuerySchema, TraceSummaryPageSchema } from './traceChain';

const traceId = '01a0ccdbcdf87001af9cbc4b3845a39b';
const taskId = '01a0bf5d-8f4b-7418-8a3f-7cbb4a1fd751';

describe('调用链列表查询', () => {
  test('缺省看全部时间、每页 50 条，地址里的数字字符串按数字解析', () => {
    expect(TraceListQuerySchema.parse({})).toEqual({ window: 'all', limit: 50 });
    expect(TraceListQuerySchema.parse({ source: 'event', status: 'failed', window: '24h', limit: '20' })).toEqual({ source: 'event', status: 'failed', window: '24h', limit: 20 });
  });

  test('游标必须是「毫秒时间~traceId」，来源、状态、时间范围只收约定的取值', () => {
    expect(TraceListQuerySchema.parse({ cursor: `2026-09-23T10:12:00.000Z~${traceId}` }).cursor).toBe(`2026-09-23T10:12:00.000Z~${traceId}`);
    expect(TraceListQuerySchema.safeParse({ cursor: `2026-09-23T10:12:00Z~${traceId}` }).success).toBe(false);
    expect(TraceListQuerySchema.safeParse({ cursor: 'next' }).success).toBe(false);
    expect(TraceListQuerySchema.safeParse({ source: 'cli' }).success).toBe(false);
    expect(TraceListQuerySchema.safeParse({ status: 'succeeded' }).success).toBe(false);
    expect(TraceListQuerySchema.safeParse({ window: '30d' }).success).toBe(false);
    expect(TraceListQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(TraceListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });
});

describe('调用链返回形状', () => {
  test('列表页：一条链至少有一个来源，下一页游标可省', () => {
    const row = { traceId, status: 'running', startedAt: '2026-09-23T10:12:00.000Z', lastActivityAt: '2026-09-23T10:20:00.000Z', sources: ['event', 'business-task'],
      event: { eventType: 'gitlab.push', state: 'delivered', attempts: 1 }, business: { tasks: 1, subtasks: 2, failedSubtasks: 1 } };
    expect(TraceSummaryPageSchema.parse({ items: [row] }).items[0]?.sources).toEqual(['event', 'business-task']);
    expect(TraceSummaryPageSchema.safeParse({ items: [{ ...row, sources: [] }] }).success).toBe(false);
    expect(TraceSummaryPageSchema.safeParse({ items: [{ ...row, traceId: 'not-a-trace' }] }).success).toBe(false);
  });

  test('分层回放：任务下挂执行与子任务，状态只取三档', () => {
    const chain = {
      traceId, status: 'failed', startedAt: '2026-09-23T10:12:00.000Z', lastActivityAt: '2026-09-23T10:20:00.000Z', sources: ['business-task'],
      tasks: [{
        taskId, kind: 'business', state: 'released', status: 'failed', createdAt: '2026-09-23T10:12:00.000Z', lastActivityAt: '2026-09-23T10:20:00.000Z',
        business: { state: 'closed', callerIdentity: 'demo' },
        executions: [{ taskId, purpose: 'subtask', agentId: 'a1', status: 'failed', startedAt: '2026-09-23T10:12:01.000Z', sessionIds: ['ses_1'], events: 3 }],
        subtasks: [{ subtaskId: '01a0c12a-de2d-7000-be47-11b445498123', name: 'analysis', kind: 'agent', state: 'failed', attempt: 1, createdAt: '2026-09-23T10:12:01.000Z' }],
      }],
    };
    expect(TraceChainDtoSchema.parse(chain).tasks[0]?.executions[0]?.sessionIds).toEqual(['ses_1']);
    expect(TraceChainDtoSchema.safeParse({ ...chain, status: 'succeeded' }).success).toBe(false);
  });

  test('事件分页：游标是序号，缺省每页 100 条，至多 200 条', () => {
    expect(TraceEventsQuerySchema.parse({})).toEqual({ limit: 100 });
    expect(TraceEventsQuerySchema.parse({ cursor: '42', limit: '200' })).toEqual({ cursor: '42', limit: 200 });
    expect(TraceEventsQuerySchema.safeParse({ cursor: '-1' }).success).toBe(false);
    expect(TraceEventsQuerySchema.safeParse({ limit: 201 }).success).toBe(false);
    const page = TraceEventPageSchema.parse({ items: [{ seq: 7, at: '2026-09-23T10:12:02.000Z', kind: 'agent', type: 'tool-start', tool: { name: 'bash' } }], nextCursor: '7' });
    expect(page.items[0]?.tool?.name).toBe('bash');
    expect(TraceEventPageSchema.safeParse({ items: [{ seq: 7, at: '2026-09-23T10:12:02.000Z', kind: 'exec' }] }).success).toBe(false);
  });
});
