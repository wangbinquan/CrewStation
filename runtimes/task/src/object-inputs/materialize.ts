import { TaskInputManifestSchema, OBJECT_STORAGE_LIMITS } from '@crewstation/contracts';
import type { TaskInputManifest } from '@crewstation/contracts';

export async function writeTaskInput(root: string, item: TaskInputManifest['items'][number], body: ReadableStream<Uint8Array>, uid: number, gid: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const writer = Bun.spawn(['/usr/bin/python3', `${import.meta.dir}/write_input.py`, JSON.stringify({ root, ...item, uid, gid })], { env: { LANG: 'C.UTF-8' }, stdin: body, stdout: 'ignore', stderr: 'ignore' });
  const abort = () => { writer.kill('SIGTERM'); };
  signal.addEventListener('abort', abort, { once: true });
  try { if (await writer.exited !== 0) throw new Error('任务输入无法安全落盘：长度、摘要或目标路径不符'); signal.throwIfAborted(); }
  finally { signal.removeEventListener('abort', abort); }
}
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('输入清单为空');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) { const item = await reader.read(); if (item.done) break; bytes += item.value.byteLength; if (bytes > OBJECT_STORAGE_LIMITS.pageBytes) throw new Error('输入清单超出上限'); chunks.push(item.value); }
    return JSON.parse(Buffer.concat(chunks).toString());
  } finally { await reader.cancel(); reader.releaseLock(); }
}
/** Executed before Runner connection/initializers, so no business child can race input publication. */
export async function materializeTaskInputs(input: { baseUrl: string; token: string; podUid: string; root: string; uid: number; gid: number; signal: AbortSignal }): Promise<void> {
  const base = new URL(input.baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || !/^\/internal\/task-inputs\/[a-f0-9-]{36}$/.test(base.pathname) || !/^[a-zA-Z0-9_-]{43}$/.test(input.token) || !/^[a-f0-9-]{36}$/.test(input.podUid)) throw new Error('任务输入授权配置无效');
  const request = async (path: string, method = 'GET', transfer = false) => {
    const response = await fetch(`${base.href}${path}`, { method, redirect: 'error', headers: { authorization: `Bearer ${input.token}`, 'x-cs-input-pod-uid': input.podUid }, signal: AbortSignal.any([input.signal, AbortSignal.timeout(transfer ? OBJECT_STORAGE_LIMITS.transferSeconds * 1000 : 30_000)]) });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`任务输入读取未完成（HTTP ${response.status}）`); } return response;
  };
  const manifest = TaskInputManifestSchema.parse(await boundedJson(await request('')));
  if (manifest.completed) return;
  if (manifest.items.reduce((sum, item) => sum + item.size, 0) > OBJECT_STORAGE_LIMITS.archiveBytes) throw new Error('任务输入总大小超过上限');
  for (const item of manifest.items) {
    const response = await request(`/objects/${item.objectId}`, 'GET', true);
    if (!response.body || response.headers.get('content-length') !== String(item.size) || response.headers.get('x-cs-object-sha256') !== item.sha256) { await response.body?.cancel(); throw new Error('任务输入响应与固定版本不一致'); }
    await writeTaskInput(input.root, item, response.body, input.uid, input.gid, input.signal);
  }
  await (await request('/complete', 'POST')).body?.cancel();
}

export async function materializeTaskInputsFromEnv(root: string, uid: number, gid: number): Promise<void> {
  const baseUrl = process.env['CS_OBJECT_INPUT_URL']; if (!baseUrl) return;
  const token = process.env['CS_OBJECT_INPUT_TOKEN'] ?? ''; delete process.env['CS_OBJECT_INPUT_TOKEN'];
  const stop = new AbortController(), abort = () => { stop.abort(); };
  process.once('SIGTERM', abort); process.once('SIGINT', abort);
  try { await materializeTaskInputs({ baseUrl, token, podUid: process.env['CS_RUNTIME_POD_UID'] ?? '', root, uid, gid, signal: AbortSignal.any([stop.signal, AbortSignal.timeout(60 * 60_000)]) }); }
  finally { process.off('SIGTERM', abort); process.off('SIGINT', abort); delete process.env['CS_OBJECT_INPUT_TOKEN']; }
}
