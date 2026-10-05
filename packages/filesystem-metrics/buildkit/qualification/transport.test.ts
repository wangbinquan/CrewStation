import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBuildKitInputClient, createBuildKitInputHandler } from './transport';
import { createFilesystemMetricsHandler } from '../../server';

const token = 'native-buildkit-input-token'.repeat(2), query = { key: 'original', directory: 'cache', storageIds: ['1'] };
async function fixture(work: (root: string, templateRoot: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'buildkit-input-transport-')), templateRoot = join(root, 'template');
  try {
    const fs = join(root, 'cache/runc-overlayfs/snapshots/snapshots/1/fs');
    await mkdir(fs, { recursive: true }); await mkdir(templateRoot);
    for (const path of [join(fs, '.gitignore'), join(templateRoot, '.gitignore')]) await writeFile(path, 'private-template-bytes');
    await work(root, templateRoot);
  } finally { await rm(root, { recursive: true, force: true }); }
}
test('the installed authenticated handler binds complete native inputs and the independent template without exposing bytes', () => fixture(async (root, templateRoot) => {
  const handler = createBuildKitInputHandler({ root, templateRoot, token });
  const client = createBuildKitInputClient({ baseUrl: 'http://original', token, fetch: (url, init) => handler(new Request(url, init)) });
  const result = await client.observe(query);
  expect(result.inputs[0]!.sharedPlatformContentsProven).toBe(true); expect(result.inputs[0]!.files[0]!.path).toBe('.gitignore');
  expect(result.physicalReclamationProven).toBe(false); expect(JSON.stringify(result)).not.toContain('private-template-bytes');
  await writeFile(join(root, 'cache/runc-overlayfs/snapshots/snapshots/1/fs/project'), 'project-private-bytes');
  expect((await client.observe(query)).inputs[0]!.sharedPlatformContentsProven).toBe(false);
  expect((await handler(new Request('http://original/buildkit/platform-inputs', { method: 'POST', body: JSON.stringify(query) }))).status).toBe(401);
  const forbidden = await handler(new Request('http://original/buildkit/platform-inputs', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: JSON.stringify({ ...query, templateRoot: '/caller' }) }));
  expect(forbidden.status).toBe(503);
}));
test('a complete original input transport rejects substitution, omitted storage, digest tampering and incomplete EOF', () => fixture(async (root, templateRoot) => {
  const handler = createBuildKitInputHandler({ root, templateRoot, token });
  const original = await (await handler(new Request('http://original/buildkit/platform-inputs', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: JSON.stringify(query) }))).json();
  for (const change of [{ key: 'other' }, { inputs: [] }, { inputs: [{ ...original.inputs[0], storageId: '2' }] }, { inputs: [{ ...original.inputs[0], sharedPlatformContentsProven: false }] }, { identity: '0'.repeat(64) }]) {
    const client = createBuildKitInputClient({ baseUrl: 'http://original', token, fetch: async () => Response.json({ ...original, ...change }) });
    await expect(client.observe(query)).rejects.toThrow();
  }
  await expect(createBuildKitInputClient({ baseUrl: 'http://original', token, fetch: async () => new Response('{"version":') }).observe(query)).rejects.toThrow();
}));
test('shared probe installation exposes private input routes only with both installation-owned roots', () => fixture(async (root, templateRoot) => {
  expect(() => createFilesystemMetricsHandler({ token, roots: {}, buildkitTemplateRoot: templateRoot })).toThrow('local root');
  const configured = createFilesystemMetricsHandler({ token, roots: { local: root }, buildkitTemplateRoot: templateRoot });
  expect((await createBuildKitInputClient({ baseUrl: 'http://original', token, fetch: (url, init) => configured(new Request(url, init)) }).observe(query)).complete).toBe(true);
  const disabled = createFilesystemMetricsHandler({ token, roots: { local: root } });
  expect((await disabled(new Request('http://original/buildkit/platform-inputs', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: JSON.stringify(query) }))).status).toBe(404);
}));
