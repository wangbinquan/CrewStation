import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { rm, rename, symlink, chmod } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ProjectDeletionContextSchema } from '../../../packages/contracts';
import { jsonHash, newResourceId } from '../../../packages/kernel';
import type { RegistryDeletionHistory } from '../../../packages/filesystem-metrics';
import { consumerFixture } from '../../../packages/filesystem-metrics/consumerFixture';
import { registryArtifactFixture } from '../../../modules/platform/adapters/k8s/nativeRegistry/artifactFixture';
import { nativeRegistryJournal } from './journal';

async function fixture(work: (file: string, history: RegistryDeletionHistory) => Promise<void>) {
  await consumerFixture(async proc => {
    await Bun.write(join(proc.root, 'sys/kernel/random/boot_id'), randomUUID() + '\n'); await proc.process('101');
    const f = await registryArtifactFixture(proc.root);
    try { await work(join(f.root, 'journal.sqlite'), await f.source.capture(projectId, f.query)); } finally { await f.drop(); }
  });
}
const projectId = newResourceId();
const context = ProjectDeletionContextSchema.parse({ operationId: newResourceId(), generation: 1, phase: 'purge',
  target: { id: projectId, name: 'Original', slug: 'original', namespace: 'cs-original', kind: 'DigitalWorker', state: 'deleting', revision: '1', prodHost: 'original.invalid', previewHost: 'preview.original.invalid', serviceHost: 'original.service.invalid' },
  confirmed: { participant: 'release', complete: true, revision: jsonHash('original plan'), blockers: [], references: [], resources: [] } });

test('original callback finally durably clears admission only after its actual completion', async () => fixture(async (file, history) => {
  const sourceIdentity = history.sourceIdentity;
  const journal = nativeRegistryJournal(file, sourceIdentity);
  try {
    expect(journal.status()).toMatchObject({ complete: true, active: 0, total: 0 });
    const callback = journal.begin(context, history);
    expect(journal.status()).toMatchObject({ active: 1, total: 1 });
    expect(() => journal.begin(context, history)).toThrow('still runs');
    callback.finish(); expect(journal.status()).toMatchObject({ active: 0, total: 1 });
    expect(() => callback.finish()).toThrow('already consumed');
  } finally { journal.close(); }
  const reopened = nativeRegistryJournal(file, sourceIdentity);
  try { expect(reopened.status()).toMatchObject({ active: 0, total: 1 }); } finally { reopened.close(); }
}));

test('operator restart and lost native callback never turn original running work into zero', async () => fixture(async (file, history) => {
  const sourceIdentity = history.sourceIdentity;
  const original = nativeRegistryJournal(file, sourceIdentity), callback = original.begin(context, history), identity = original.identity;
  original.close(); expect(() => callback.finish()).toThrow('closed');
  const reopened = nativeRegistryJournal(file, sourceIdentity);
  try {
    expect(reopened.identity).toBe(identity);
    expect(reopened.status()).toMatchObject({ active: 1, total: 1 });
    expect(() => reopened.begin(context, history)).toThrow('still runs');
    const db = new Database(file);
    try {
      expect(() => db.run('DELETE FROM registry_work')).toThrow('cannot be removed');
      expect(() => db.run("UPDATE registry_work SET state='finished',exited_at='now',exit_digest='forged'")).toThrow();
    } finally { db.close(); }
    expect(reopened.status().active).toBe(1);
  } finally { reopened.close(); }
}));

test('journal file replacement, symlink and unrelated source cannot authorize a fresh idle status', async () => fixture(async (file, history) => {
  const sourceIdentity = history.sourceIdentity;
  const original = nativeRegistryJournal(file, sourceIdentity); original.begin(context, history);
  await rename(file, file + '.original');
  expect(() => original.status()).toThrow(); original.close();
  await symlink(file + '.original', file);
  expect(() => nativeRegistryJournal(file, sourceIdentity)).toThrow('unsupported');
  await rm(file); await rename(file + '.original', file);
  expect(() => nativeRegistryJournal(file, jsonHash('other-source'))).toThrow('source changed');
}));

test('an existing unknown schema or writable journal parent is rejected', async () => fixture(async (file, history) => {
  const sourceIdentity = history.sourceIdentity;
  const db = new Database(file); db.run('CREATE TABLE other(value TEXT)'); db.close();
  expect(() => nativeRegistryJournal(file, sourceIdentity)).toThrow('unknown existing');
  await rm(file); await chmod(join(file, '..'), 0o777);
  expect(() => nativeRegistryJournal(file, sourceIdentity)).toThrow('protected directory');
}));
