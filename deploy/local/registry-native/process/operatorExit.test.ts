import { expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { consumerFixture } from '../../../../packages/filesystem-metrics/consumerFixture';
import { captureRegistryOperatorBirth, proveRegistryOperatorExit } from './operatorExit';

test('actual original stat birth and fixed kernel EOF distinguish a live operator, PID reuse, disappearance and source replacement', async () => consumerFixture(async f => {
  const boot = randomUUID(); await mkdir(join(f.root, 'sys/kernel/random'), { recursive: true }); await mkdir(join(f.root, 'self/ns'), { recursive: true });
  await writeFile(join(f.root, 'sys/kernel/random/boot_id'), boot + '\n'); await f.process('101');
  const original = await captureRegistryOperatorBirth(f.root, 101); expect(original.pid).toBe(101); expect(await proveRegistryOperatorExit(original, f.root)).toBeUndefined();
  const stat = await Bun.file(join(f.root, '101/stat')).text(); const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/); fields[19] = String(Number(fields[19]) + 1);
  await writeFile(join(f.root, '101/stat'), '101 (reused operator) ' + fields.join(' ')); expect(await proveRegistryOperatorExit(original, f.root)).toMatch(/^[a-f0-9]{64}$/);
  await rm(join(f.root, '101'), { recursive: true }); expect(await proveRegistryOperatorExit(original, f.root)).toMatch(/^[a-f0-9]{64}$/);
  await writeFile(join(f.root, 'sys/kernel/random/boot_id'), randomUUID() + '\n'); await expect(proveRegistryOperatorExit(original, f.root)).rejects.toThrow('kernel source changed');
}));
