import { expect, test } from 'bun:test';
import { bindStorageDeploymentTargets, importedManifestDigest, pinStorageManifest } from './targets';

test('deployment uses inspected image IDs and immutable imported digests even if dev tags change', async () => {
  const id = `sha256:${'a'.repeat(64)}`, content = JSON.stringify({ config: { digest: id } }), digest = `sha256:${new Bun.CryptoHasher('sha256').update(content).digest('hex')}`, calls: string[][] = [], imports: string[] = [];
  const run = async (args: string[]) => { calls.push(args); return args.includes('{{.Id}}') ? id : args.includes('ls') ? `${args.at(-1)!.slice(6)} application/vnd.oci.image.manifest.v1+json ${digest} 1MiB linux/arm64` : args.includes('get') ? content : ''; };
  const targets = await bindStorageDeploymentTargets(run, async (tag) => { imports.push(tag); }, [{ image: 'cs-control-plane:dev', id }, { image: 'cs-task-runtime:dev', id }], 'node', 'registry:5000');
  expect(calls.filter((args) => args[1] === 'tag').every((args) => args[2] === id)).toBe(true);
  expect(imports.every((tag) => !tag.endsWith(':dev'))).toBe(true);
  expect(targets.images['cs-control-plane:dev']).toBe(`docker.io/library/cs-control-plane@${digest}`);
  expect(targets.taskImage).toBe(`registry:5000/crewstation/task-runtime@${digest}`);
  const source = { spec: { containers: [{ image: 'cs-control-plane:dev', envFrom: [{ secretRef: { name: 'keep' } }] }, { image: 'other:dev' }] }, data: { CS_TASK_IMAGE: 'old:dev', CS_OTHER: 'keep' } };
  const pinned = pinStorageManifest(source, targets);
  expect(pinned).toEqual({ spec: { containers: [{ image: targets.images['cs-control-plane:dev'], envFrom: [{ secretRef: { name: 'keep' } }] }, { image: 'other:dev' }] }, data: { CS_TASK_IMAGE: targets.taskImage, CS_OTHER: 'keep' } });
  expect(source.spec.containers[0]!.image).toBe('cs-control-plane:dev');
});
test('containerd listing requires exactly the imported reference and a complete manifest digest', () => {
  const ref = 'docker.io/library/cs-api:storage-abc', digest = `sha256:${'a'.repeat(64)}`;
  expect(importedManifestDigest(`REF TYPE DIGEST SIZE\n${ref} application/vnd.oci.image.manifest.v1+json ${digest} 12 MiB linux/arm64`, ref)).toBe(digest);
  expect(() => importedManifestDigest(`${ref} type ${digest}\n${ref} type ${digest}`, ref)).toThrow();
  expect(() => importedManifestDigest(`other type ${digest}`, ref)).toThrow();
});
test('a missing identity or failed exact-image import blocks all following steps', async () => {
  const id = `sha256:${'a'.repeat(64)}`, snapshot = [{ image: 'cs-control-plane:dev', id }]; let imported = false;
  await expect(bindStorageDeploymentTargets(async () => 'other', async () => { imported = true; }, snapshot, 'node', 'registry')).rejects.toThrow('changed');
  expect(imported).toBe(false);
  await expect(bindStorageDeploymentTargets(async () => id, async () => { throw new Error('import failed'); }, snapshot, 'node', 'registry')).rejects.toThrow('import failed');
  await expect(bindStorageDeploymentTargets(async (args) => args.includes('{{.Id}}') ? id : '{}', async () => {}, snapshot, 'node', 'registry')).rejects.toThrow('manifest identity');
});
