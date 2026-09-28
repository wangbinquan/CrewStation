import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { materializeTaskInputs, writeTaskInput } from './materialize';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'cs-task-input-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const contents = 'fixed input bytes\n'.repeat(8192), digest = new Bun.CryptoHasher('sha256').update(contents).digest('hex');
const item = { path: 'plugins/bundle.bin', objectId: Bun.randomUUIDv7(), size: Buffer.byteLength(contents), sha256: digest };
const body = (text = contents) => new Blob([text]).stream();
const uid = process.getuid!(), gid = process.getgid!();
test('streamed input is fsynced and replayable; a changed existing file is never overwritten', async () => {
  const signal = new AbortController().signal;
  await writeTaskInput(root, item, body(), uid, gid, signal); await writeTaskInput(root, item, body(), uid, gid, signal);
  expect(await readFile(join(root, item.path), 'utf8')).toBe(contents);
  await writeFile(join(root, item.path), 'user changes');
  await expect(writeTaskInput(root, item, body(), uid, gid, signal)).rejects.toThrow('安全落盘');
  expect(await readFile(join(root, item.path), 'utf8')).toBe('user changes');
  expect(await readdir(join(root, 'plugins'))).toEqual(['bundle.bin']);
});
test('truncation, wrong digest, path traversal and symlinks cannot publish bytes outside the workspace', async () => {
  const signal = new AbortController().signal;
  for (const patch of [{ size: item.size - 1 }, { size: item.size + 1 }, { sha256: 'b'.repeat(64) }, { path: '../escape' }]) await expect(writeTaskInput(root, { ...item, ...patch }, body(), uid, gid, signal)).rejects.toThrow();
  expect(await readdir(join(root, 'plugins'))).toEqual([]);
  await symlink('/tmp', join(root, 'unsafe'));
  await expect(writeTaskInput(root, { ...item, path: 'unsafe/escape.bin' }, body(), uid, gid, signal)).rejects.toThrow();
  await mkdir(join(root, 'safe')); await symlink('/dev/null', join(root, 'safe', 'target'));
  await expect(writeTaskInput(root, { ...item, path: 'safe/target' }, body(), uid, gid, signal)).rejects.toThrow();
});
test('helper uses only fixed object IDs, verifies metadata and bytes, and completed initialization survives changed workspace files', async () => {
  const id = Bun.randomUUIDv7(), token = 't'.repeat(43), podUid = crypto.randomUUID(), requests: string[] = []; let completed = false, corrupt = false;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: (request) => {
    if (request.headers.get('authorization') !== `Bearer ${token}` || request.headers.get('x-cs-input-pod-uid') !== podUid) return new Response(null, { status: 403 });
    const path = new URL(request.url).pathname; requests.push(path);
    if (path.endsWith('/complete')) { completed = true; return new Response(null, { status: 204 }); }
    if (path.endsWith(`/objects/${item.objectId}`)) return new Response(corrupt ? contents + 'wrong' : contents, { headers: { 'content-length': String(item.size), 'x-cs-object-sha256': item.sha256 } });
    return Response.json({ completed, items: completed ? [] : [item] });
  } });
  try {
    const input = { baseUrl: `http://127.0.0.1:${server.port}/internal/task-inputs/${id}`, token, podUid, root, uid, gid, signal: AbortSignal.timeout(10_000) };
    await materializeTaskInputs(input); expect(completed).toBe(true); expect(requests).toHaveLength(3);
    await writeFile(join(root, item.path), 'modified by task'); await materializeTaskInputs(input);
    expect(await readFile(join(root, item.path), 'utf8')).toBe('modified by task'); expect(requests).toHaveLength(4);
    completed = false; corrupt = true; await expect(materializeTaskInputs(input)).rejects.toThrow(); expect(completed).toBe(false);
    await expect(materializeTaskInputs({ ...input, token: 'z'.repeat(43) })).rejects.toThrow('403');
    await expect(materializeTaskInputs({ ...input, baseUrl: 'http://external/other' })).rejects.toThrow('配置无效');
  } finally { await server.stop(true); }
});
