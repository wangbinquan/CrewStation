import { expect, test } from 'bun:test';
import { writeFile, symlink, rm, readFile, open } from 'node:fs/promises';
import { join } from 'node:path';
import { observeFileConsumers } from './consumers';
import { consumerFixture as fixture } from './consumerFixture';

test('one original file is retained by an FD and a closed-FD mapping; no path, contents or process name is exposed', () => fixture(async (f) => {
  const first = await f.process('22'), second = await f.process('23', '411');
  await symlink(f.file, join(first, 'fd/7'));
  const device = BigInt(f.identity.device), major = ((device >> 8n) & 0xfffn) | ((device >> 32n) & ~0xfffn), minor = (device & 0xffn) | ((device >> 12n) & ~0xffn);
  await writeFile(join(second, 'maps'), `7000-8000 r--p 0000 ${major.toString(16)}:${minor.toString(16)} ${f.identity.inode} /secret/customer-name (deleted)\n9000-a000 rw-p 0 00:00 0\n`);
  const result = await observeFileConsumers([f.identity], f.root);
  expect(result.complete).toBe(true); expect(result.consumers).toEqual([
    { pid: 22, tid: 22, startedTick: '311', kind: 'descriptor', ...f.identity }, { pid: 23, tid: 23, startedTick: '411', kind: 'mapping', ...f.identity },
  ]); expect(result.blockers).toEqual([]);
  for (const secret of ['private body', 'private process', 'customer-name', f.file]) expect(JSON.stringify(result)).not.toContain(secret);
}));
test('a nonleader thread with its own descriptor table retains the file; unreadable threads cannot be skipped', () => fixture(async (f) => {
  await f.process('22'); const thread = await f.thread('22', '24'); await symlink(f.file, join(thread, 'fd/8'));
  const result = await observeFileConsumers([f.identity], f.root); expect(result.complete).toBe(true);
  expect(result.consumers).toEqual([{ pid: 22, tid: 24, startedTick: '811', kind: 'descriptor', ...f.identity }]);
  await rm(join(thread, 'maps')); expect((await observeFileConsumers([f.identity], f.root)).complete).toBe(false);
}));

test('cwd, executable and root references also retain original source identities', () => fixture(async (f) => {
  const path = await f.process('22'); for (const name of ['cwd', 'root', 'exe']) await symlink(f.file, join(path, name));
  const result = await observeFileConsumers([f.identity], f.root); expect(result.complete).toBe(true);
  expect(result.consumers.map((row) => row.kind)).toEqual(['cwd', 'root', 'executable']);
}));

test('an inaccessible descriptor or malformed mapping never becomes zero-consumer proof', () => fixture(async (f) => {
  const path = await f.process('22'); await symlink(join(path, 'fd/7'), join(path, 'fd/7'));
  let result = await observeFileConsumers([f.identity], f.root); expect(result.complete).toBe(false); expect(result.blockers).toEqual([{ code: 'process-unreadable', pid: 22 }]);
  await rm(join(path, 'fd/7')); await writeFile(join(path, 'maps'), 'unrecognized source format\n');
  result = await observeFileConsumers([f.identity], f.root); expect(result.complete).toBe(false); expect(result.blockers[0]?.pid).toBe(22);
}));

test('a descriptor already closed is absent while a stable visible namespace is still required', () => fixture(async (f) => {
  const path = await f.process('22'); await symlink(join(path, 'already-closed'), join(path, 'fd/7'));
  const result = await observeFileConsumers([f.identity], f.root); expect(result.complete).toBe(true); expect(result.consumers).toEqual([]);
  await rm(join(path, 'stat')); expect((await observeFileConsumers([f.identity], f.root)).complete).toBe(false);
}));

test('missing source, wrong source epoch and invalid identities fail closed; cancellation remains observable', () => fixture(async (f) => {
  expect((await observeFileConsumers([f.identity], join(f.root, 'missing'))).blockers).toEqual([{ code: 'source-unreadable' }]);
  expect((await observeFileConsumers([f.identity], f.root)).complete).toBe(false);
  await f.process('22'); await writeFile(join(f.root, 'sys/kernel/random/boot_id'), 'bad-epoch');
  expect((await observeFileConsumers([f.identity], f.root)).complete).toBe(false);
  await expect(observeFileConsumers([{ device: '-1', inode: '0' }], f.root)).rejects.toThrow('Invalid retained file identity');
  await expect(observeFileConsumers([f.identity], f.root, AbortSignal.abort(new Error('cancelled')))).rejects.toThrow('cancelled');
  expect(await readFile(f.file, 'utf8')).toContain('must never appear');
}));

test('a retained descriptor opened during a thread scan cannot be reported as complete zero consumers', () => fixture(async (f) => {
  const path = await f.process('22'), maps = join(path, 'maps');
  await rm(maps); const fifo = Bun.spawn(['mkfifo', maps], { stdout: 'ignore', stderr: 'pipe' }); expect(await fifo.exited).toBe(0);
  const observing = observeFileConsumers([f.identity], f.root);
  // Opening the writer waits for the reader to reach maps, after its first descriptor enumeration.
  const writer = await open(maps, 'w');
  try {
    await symlink(f.file, join(path, 'fd/8')); await rm(maps); await writeFile(maps, '');
  } finally { await writer.close(); }
  const result = await observing;
  expect(result.complete).toBe(false); expect(result.blockers).toEqual([{ code: 'process-changed', pid: 22 }]);
}));

test('cancellation during the final source recheck remains observable instead of completing the proof', () => fixture(async (f) => {
  const path = await f.process('22'), maps = join(path, 'maps'), boot = join(f.root, 'sys/kernel/random/boot_id'), controller = new AbortController();
  await rm(maps); expect(await Bun.spawn(['mkfifo', maps], { stdout: 'ignore', stderr: 'ignore' }).exited).toBe(0);
  const observing = observeFileConsumers([f.identity], f.root, controller.signal);
  const outcome = observing.catch((error: unknown) => error);
  const first = await open(maps, 'w');
  try {
    await rm(boot); expect(await Bun.spawn(['mkfifo', boot], { stdout: 'ignore', stderr: 'ignore' }).exited).toBe(0);
    await rm(maps); await writeFile(maps, '');
  } finally { await first.close(); }
  // The final boot-id read is metadata I/O too; cancellation there must not emit a completed source observation.
  const last = await open(boot, 'w');
  try { controller.abort(new Error('cancelled during source recheck')); await last.write('12345678-1234-1234-1234-123456789abc\n'); } finally { await last.close(); }
  expect(await outcome).toBeInstanceOf(Error);
  await expect(observing).rejects.toThrow('cancelled during source recheck');
}));
