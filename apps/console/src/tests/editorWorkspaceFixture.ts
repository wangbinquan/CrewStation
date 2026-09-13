import type { TaskStreamCommandInput } from '@crewstation/api-client';
import { activityFixture, activityProjectId, activityTaskId, activityUserId, activityTime } from './agentActivityFixture';

/** 测真实路由、任务流与 CodeMirror；仅替代服务端 HTTP／WS 的确定性边界。 */
export function editorWorkspaceFixture() {
  const f = activityFixture(), commands: Array<TaskStreamCommandInput & { id: string }> = [], writes: Array<{ path: string; method: string }> = [];
  const files = new Map([['a.ts', '磁盘原文'], ['b.ts', '第二个文件']]);
  const originalFetch = globalThis.fetch, originalSocket = globalThis.WebSocket, originalHref = window.location.href;
  window.location.href = 'http://localhost/';
  let pendingWrite: (() => void) | undefined;
  class Socket {
    static OPEN = 1;
    readyState = 1;
    onmessage?: (message: { data: string }) => void;
    onclose?: () => void;
    constructor() { queueMicrotask(() => this.receive({ type: 'streamReady', connected: true, replayed: 0 })); }
    receive(frame: object) { if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(frame) }); }
    close() { this.readyState = 3; this.onclose?.(); }
    send(data: string) {
      const command = JSON.parse(data) as TaskStreamCommandInput & { id: string }; commands.push(command);
      let payload: unknown = {};
      if (command.type === 'listFiles') payload = { path: '.', entries: [...files.keys()].map((name) => ({ name, kind: 'file', size: 10, modifiedAt: activityTime })) };
      else if (command.type === 'readFile') payload = { path: command.path, content: files.get(command.path), version: 'version-1', size: 10 };
      else if (command.type === 'previewStatus') payload = { state: 'disabled', restarts: 0 };
      else if (command.type === 'writeFile') {
        pendingWrite = () => { files.set(command.path, command.content); this.receive({ type: 'result', id: command.id, payload: { path: command.path, version: 'version-2' } }); };
        return;
      }
      queueMicrotask(() => this.receive({ type: 'result', id: command.id, payload }));
    }
  }
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://localhost').pathname, method = init?.method ?? 'GET';
    if (method !== 'GET') writes.push({ path, method });
    let body: unknown = { items: [] }, status = 200;
    if (path === '/v1/me') body = { id: activityUserId, name: '负责人', memberships: [{ projectId: activityProjectId, role: 'owner' }], isAdmin: false };
    else if (path === `/v1/projects/${activityProjectId}`) body = { id: activityProjectId, ownerUserId: activityUserId, serviceId: `svc_${'4'.repeat(32)}`, name: '编辑器验收', slug: 'editor', kind: 'DigitalWorker', state: 'active' };
    else if (path.endsWith('/workspace-layout')) body = method === 'PUT' ? { revision: 2, layout: JSON.parse(String(init?.body)).layout, updatedAt: activityTime } : { revision: 0, layout: null, updatedAt: null };
    else if (path.endsWith('/agent-terminals')) body = { ...f.roster, items: [] };
    else if (path.endsWith('/agent-activity')) body = { ...f.page, states: [], items: [], unread: [] };
    else if (path.endsWith('/version-comparison')) { status = 503; body = { error: 'unavailable', message: '比较暂不可用，编辑器仍可使用' }; }
    else if (path.endsWith('/workspace-status')) body = { status: 'ready', taskId: activityTaskId, branch: 'main', headSha: 'a'.repeat(40), checkedAt: activityTime, shallow: false, fingerprint: 'fp', uncommitted: [], uncommittedCount: 0, uncommittedTruncated: false, unpushed: { status: 'ready', count: 0, commits: [], truncated: false }, upstream: { status: 'missing' } };
    else if (path.endsWith('/dev-session')) body = { taskId: activityTaskId, projectId: activityProjectId, createdBy: activityUserId, branch: 'main', state: 'running', lastActivityAt: activityTime, previewHost: 'preview.localhost' };
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { commands, writes, files, finishWrite: () => { const finish = pendingWrite; pendingWrite = undefined; finish?.(); }, restore: () => { globalThis.fetch = originalFetch; globalThis.WebSocket = originalSocket; window.location.href = originalHref; } };
}
