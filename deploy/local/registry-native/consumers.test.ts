import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { symlink, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createFilesystemMetricsHandler } from '../../../packages/filesystem-metrics';
import { consumerFixture } from '../../../packages/filesystem-metrics/consumerFixture';
import { nativeRegistryConsumerReader } from './consumers';

test('native consumer pages use the actual whole-thread SDK and the same original boot namespace, including an open original file', async () => consumerFixture(async proc => {
  await Bun.write(join(proc.root, 'sys/kernel/random/boot_id'), randomUUID()); const path = await proc.process('101'); await symlink(proc.file, join(path, 'fd/5'));
  let pages = 0;
  const inspect = nativeRegistryConsumerReader(async request => { pages++; return createFilesystemMetricsHandler({ roots: { local: '/' }, token: request.headers.get('authorization')!.slice(7), procRoot: proc.root })(request); });
  const files = Array.from({ length: 300 }, (_, i) => ({ device: '1', inode: String(i + 1) })); files[0] = proc.identity;
  const result = await inspect(files, '/proc', AbortSignal.timeout(1000)); expect(pages).toBe(2); expect(result.complete).toBe(true); expect(result.consumers).toHaveLength(1); expect(result.consumers[0]).toMatchObject({ pid: 101, kind: 'descriptor', ...proc.identity });
  expect((await inspect([], '/proc', AbortSignal.timeout(1000))).complete).toBe(true);
  await expect(inspect([], '/another')).rejects.toThrow('whole host');
}));
test('unreadable host evidence remains incomplete and request cancellation is not an empty successful consumer scan', async () => {
  const inspect = nativeRegistryConsumerReader(async request => createFilesystemMetricsHandler({ roots: { local: '/' }, token: request.headers.get('authorization')!.slice(7), procRoot: '/nonexistent-cs-proc' })(request));
  expect((await inspect([], '/proc')).complete).toBe(false);
  await expect(inspect([], '/proc', AbortSignal.abort())).rejects.toThrow();
});
test('same-inode requests retain all distinct births across the whole-host reader', async () => consumerFixture(async proc => {
  await Bun.write(join(proc.root, 'sys/kernel/random/boot_id'), randomUUID()); const path = await proc.process('101'); await symlink(proc.file, join(path, 'fd/6'));
  const birthtimeNs = String((await stat(proc.file, { bigint: true })).birthtimeNs);
  const inspect = nativeRegistryConsumerReader(async req => createFilesystemMetricsHandler({ roots: {}, token: req.headers.get('authorization')!.slice(7), procRoot: proc.root })(req));
  const other = { ...proc.identity, birthtimeNs: String(BigInt(birthtimeNs) + 1n) }, actual = { ...proc.identity, birthtimeNs };
  expect((await inspect([other], '/proc')).consumers).toHaveLength(0);
  expect((await inspect([actual, other], '/proc')).consumers).toHaveLength(1);
}));
