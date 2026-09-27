import type { BusinessEventQuery, TaskId } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { validation } from '@crewstation/kernel';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { BusinessExecutionApi, BusinessExecutionCaller } from '../api/executionApi';

/** SSE observes the same durable cursor as pagination; disconnecting never mutates execution state. */
export async function executionStream(c: Context<AppEnv>, api: BusinessExecutionApi, caller: BusinessExecutionCaller, taskId: TaskId, query: BusinessEventQuery): Promise<Response> {
  const last = c.req.header('last-event-id');
  if (last && query.after && last !== query.after) throw validation('Last-Event-ID 与 after 不一致', { code: 'invalid_cursor' });
  let after = query.after ?? last;
  // Authentication, cursor errors and expired history must retain their HTTP status before opening SSE.
  let page = await api.events(caller, taskId, { ...query, ...(after ? { after } : {}) });
  return streamSSE(c, async (stream) => {
    // Bounded connection lifetime also stops a slow consumer; reconnect replays from its last received ID.
    const timeout = setTimeout(() => stream.abort(), 30_000);
    try {
      while (!stream.aborted) {
        for (const event of page.items) {
          if (stream.aborted) return;
          await stream.writeSSE({ id: event.cursor, event: event.type, data: JSON.stringify(event) });
          after = event.cursor;
        }
        if (!page.hasMore) { await stream.write(': keepalive\n\n'); await stream.sleep(1000); }
        if (!stream.aborted) page = await api.events(caller, taskId, { ...query, ...(after ? { after } : {}) });
      }
    } finally { clearTimeout(timeout); }
  });
}
