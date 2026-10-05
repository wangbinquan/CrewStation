import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBuildKitManifestClient, observeBuildKitManifests } from './manifests';
import { createFilesystemMetricsHandler } from '../../server';

test('actual native manifest bytes, recursive descriptor EOF and authenticated probe reject omissions and byte substitution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-manifests-')), directory = 'cache', token = 'original-native-manifest-token'.repeat(2);
  const blobs = join(root, directory, 'runc-overlayfs/content/blobs/sha256'), layer = 'sha256:' + '1'.repeat(64), config = 'sha256:' + '2'.repeat(64);
  const put = async (doc: unknown) => { const bytes = JSON.stringify(doc), digest = 'sha256:' + createHash('sha256').update(bytes).digest('hex'); await writeFile(join(blobs, digest.slice(7)), bytes); return { digest, size: Buffer.byteLength(bytes) }; };
  try {
    await mkdir(blobs, { recursive: true });
    const manifest = await put({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json', config: { digest: config, size: 9 }, layers: [{ digest: layer, size: 10 }], annotations: { private: 'private-project-annotation' } });
    const index = await put({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: [manifest] });
    const query = { key: 'original', directory, digests: [index.digest] }, handler = createFilesystemMetricsHandler({ token, roots: { local: root } });
    const client = createBuildKitManifestClient({ baseUrl: 'http://original', token, fetch: (url, init) => handler(new Request(url, init)) });
    const actual = await client.observe(query); expect(actual.complete).toBe(true); expect(actual.manifests).toHaveLength(2);
    expect(actual.manifests.find(row => row.digest === manifest.digest)).toMatchObject({ layers: [layer], config });
    expect(JSON.stringify(actual)).not.toContain('private-project-annotation'); expect((await observeBuildKitManifests(root, query)).identity).toBe(actual.identity);
    expect((await handler(new Request('http://original/buildkit/manifests', { method: 'POST', body: JSON.stringify(query) }))).status).toBe(401);
    await expect(createBuildKitManifestClient({ baseUrl: 'http://original', token, fetch: async () => Response.json({ ...actual, manifests: [] }) }).observe(query)).rejects.toThrow();
    await writeFile(join(blobs, manifest.digest.slice(7)), '{}'); await expect(client.observe(query)).rejects.toThrow();
    await rm(join(blobs, manifest.digest.slice(7))); await symlink(join(blobs, index.digest.slice(7)), join(blobs, manifest.digest.slice(7))); await expect(client.observe(query)).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('a native manifest body that never reaches EOF is cancelled by its original deadline', async () => {
  let cancelled = false;
  const client = createBuildKitManifestClient({ baseUrl: 'http://original', token: 'original-manifest-token'.repeat(2), fetch: async () => new Response(new ReadableStream({ cancel: () => { cancelled = true; } })) });
  await expect(client.observe({ key: 'original', directory: 'cache', digests: [] }, AbortSignal.timeout(20))).rejects.toThrow(); expect(cancelled).toBe(true);
});
