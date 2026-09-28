import { Platform, PlatformError, type Fence } from './client';
import type { Objects } from './storage';
import type { Store } from './store';

interface Page { items: Array<{ cursor: string; type: string; [key: string]: unknown }>; nextCursor: string | null; hasMore: boolean }
interface Draft { requestKey: string; taskId: string; after: string | null; next: string | null; payload: string; sha256: string; hasMore: boolean; complete: boolean; objectId: string | null }
type Entry = { kind: 'file'; path: string; name: string; required: boolean } | { kind: 'object'; objectId: string; name: string };
/** Explicit page export, never a claim that the platform's seven-day log became a permanent complete log. */
export async function exportLogPage(platform: Platform, objects: Pick<Objects, 'persist'>, logs: LogStore, input: { taskId: string; requestKey: string; after: string | null }, fence: Fence) {
  let draft = await logs.draft(input.requestKey);
  if (!draft) {
    let page: Page, expired = false;
    try { page = await platform.call<Page>(`/v3/business-tasks/${input.taskId}/events?${new URLSearchParams({ limit: '100', ...(input.after ? { after: input.after } : {}) })}`); }
    catch (error) { if (!(error instanceof PlatformError) || error.status !== 410) throw error; expired = true; page = { items: [], nextCursor: input.after, hasMore: false }; }
    const complete = !expired && !page.items.some((event) => event.type === 'gap');
    const next = page.nextCursor ?? input.after;
    const payload = [JSON.stringify({ type: 'export-range', taskId: input.taskId, after: input.after, through: next, fullLog: false, state: complete ? 'captured-page' : 'export-incomplete' }), ...page.items.map((event) => JSON.stringify(event))].join('\n') + '\n';
    if (Buffer.byteLength(payload) > 4 * 1024 ** 2) throw new Error('样例日志页超过 4 MiB；减小页数后以新请求键重试');
    draft = await logs.save({ ...input, next, payload, sha256: new Bun.CryptoHasher('sha256').update(payload).digest('hex'), complete, hasMore: page.hasMore, objectId: null }, fence);
  }
  const objectId = draft.objectId ?? await objects.persist(`logs:${draft.sha256}`, draft.payload, draft.sha256, draft.taskId, fence);
  await logs.complete(draft, objectId, fence);
  return { objectId, sha256: draft.sha256, nextCursor: draft.next, hasMore: draft.hasMore, state: draft.complete ? 'captured-page' : 'export-incomplete', fullLog: false };
}

export class LogStore {
  constructor(private readonly store: Store) {}
  async draft(key: string): Promise<Draft | undefined> { return (await this.store.db`SELECT draft FROM execution_sample_log_chunks WHERE request_key=${key}`)[0]?.draft; }
  async save(draft: Draft, fence: Fence): Promise<Draft> {
    return this.store.guard(fence, async (tx) => {
      await tx`INSERT INTO execution_sample_log_state(task_id) VALUES(${draft.taskId}) ON CONFLICT DO NOTHING`;
      const state = (await tx`SELECT * FROM execution_sample_log_state WHERE task_id=${draft.taskId} FOR UPDATE`)[0]!;
      const existing = (await tx`SELECT draft FROM execution_sample_log_chunks WHERE request_key=${draft.requestKey}`)[0]?.draft;
      if (existing) return existing;
      if (state.sealed || state.cursor !== draft.after || state.pending_key) throw new Error('日志游标已推进或另一个导出未完成；沿原键接续');
      await tx`INSERT INTO execution_sample_log_chunks(request_key,task_id,draft) VALUES(${draft.requestKey},${draft.taskId},${draft}::jsonb)`;
      await tx`UPDATE execution_sample_log_state SET pending_key=${draft.requestKey} WHERE task_id=${draft.taskId}`;
      return draft;
    });
  }
  async complete(draft: Draft, objectId: string, fence: Fence): Promise<void> {
    await this.store.guard(fence, async (tx) => {
      await tx`UPDATE execution_sample_log_chunks SET draft=jsonb_set(draft,'{objectId}',to_jsonb(${objectId}::text)) WHERE request_key=${draft.requestKey}`;
      await tx`UPDATE execution_sample_log_state SET cursor=${draft.next},pending_key=NULL,complete=complete AND ${draft.complete} WHERE task_id=${draft.taskId} AND pending_key=${draft.requestKey}`;
    });
  }
  async finalManifest(key: string, taskId: string, fence: Fence): Promise<Entry[]> {
    return this.store.guard(fence, async (tx) => {
      await tx`INSERT INTO execution_sample_log_state(task_id) VALUES(${taskId}) ON CONFLICT DO NOTHING`;
      const state = (await tx`SELECT * FROM execution_sample_log_state WHERE task_id=${taskId} FOR UPDATE`)[0]!;
      if (state.pending_key) throw new Error('日志对象尚未发布，先完成原导出');
      if (state.sealed) { if (state.sealed_key !== key) throw new Error('此任务已有终结意图'); return state.manifest; }
      const chunks = await tx`SELECT draft FROM execution_sample_log_chunks WHERE task_id=${taskId} ORDER BY request_key LIMIT 10000`;
      if (chunks.length > 9999) throw new Error('归档清单超过 10000 个产物');
      const entries: Entry[] = [{ kind: 'file', path: 'proof.txt', name: 'proof.txt', required: true }, ...chunks.map((row, index) => ({ kind: 'object' as const, objectId: row.draft.objectId, name: `events-${index}-${row.draft.complete ? 'page' : 'incomplete'}.ndjson` }))];
      await tx`UPDATE execution_sample_log_state SET sealed=true,sealed_key=${key},manifest=${entries}::jsonb WHERE task_id=${taskId}`;
      return entries;
    });
  }
}
