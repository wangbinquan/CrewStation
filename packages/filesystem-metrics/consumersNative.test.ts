import { expect, test } from 'bun:test';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { observeFileConsumers } from './consumers';

// The hosted Linux job exercises the kernel-backed path. Other platforms
// exercise the asynchronous controlled proc fixtures in consumers.test.ts.
if (process.platform === 'linux') {
  test('native proc retains an actual open inode and sees its actual close without exposing file contents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'native-consumer-')), path = join(root, 'private');
    await writeFile(path, 'private source must not be returned'); const handle = await open(path, 'r');
    try {
      const original = await handle.stat({ bigint: true }), identity = { device: String(original.dev), inode: String(original.ino) };
      let held = await observeFileConsumers([identity]);
      for (let attempt = 0; attempt < 2 && !held.consumers.some(row => row.pid === process.pid); attempt++) held = await observeFileConsumers([identity]);
      expect(held.consumers.some(row => row.pid === process.pid && row.kind === 'descriptor' && row.inode === identity.inode)).toBe(true);
      expect(JSON.stringify(held)).not.toContain('private source'); expect(JSON.stringify(held)).not.toContain(path);
      await handle.close(); const released = await observeFileConsumers([identity]);
      expect(released.consumers.some(row => row.pid === process.pid && row.inode === identity.inode)).toBe(false);
      expect(held.bootId).toBe(released.bootId); expect(held.namespace).toBe(released.namespace);
    } finally { await handle.close().catch(() => {}); await rm(root, { recursive: true, force: true }); }
  });
  test('cancellation arriving during native metadata reads cannot become a completed empty scan', async () => {
    const controller = new AbortController(), observation = observeFileConsumers([], '/proc', controller.signal);
    queueMicrotask(() => controller.abort(Error('native scan cancelled')));
    await expect(observation).rejects.toThrow('native scan cancelled');
  });
}
