import { readFile, writeFile } from 'node:fs/promises';
import { requireCheckedTaskTarget, runStorageGuardCommand, storageDeploymentPreflight, type StorageGuardCommand } from './compatibility';

interface Snapshot { image: string; id: string }
export interface StorageDeploymentTargets { readonly images: Record<string, string>; readonly taskImage?: string }
const digestPattern = /^sha256:[a-f0-9]{64}$/;
/** Select by the inspected configuration ID, then bind Kubernetes to the imported manifest digest. */
export async function bindStorageDeploymentTargets(run: StorageGuardCommand, importImage: (tag: string) => Promise<void>, snapshots: readonly Snapshot[], node: string, registry: string): Promise<StorageDeploymentTargets> {
  const images: Record<string, string> = {}; let taskImage: string | undefined;
  for (const snapshot of snapshots) {
    if (!digestPattern.test(snapshot.id) || !/^cs-[a-z-]+:dev$/.test(snapshot.image)) throw new Error('Invalid checked image identity');
    const repository = snapshot.image.split(':')[0]!, tag = `${repository}:storage-${snapshot.id.slice(7)}`;
    await run(['docker', 'tag', snapshot.id, tag]);
    const current = (await run(['docker', 'image', 'inspect', tag, '--format', '{{.Id}}'])).trim();
    if (current !== snapshot.id) throw new Error('Checked image identity changed before import');
    await importImage(tag);
    const source = `docker.io/library/${tag}`;
    const listing = await run(['docker', 'exec', node, 'ctr', '-n', 'k8s.io', 'images', 'ls', `name==${source}`]);
    const digest = importedManifestDigest(listing, source);
    if (!await matchesCheckedImage(run, node, digest, snapshot.id)) throw new Error('Imported image differs from the checked configuration');
    const pinned = `docker.io/library/${repository}@${digest}`;
    await run(['docker', 'exec', node, 'ctr', '-n', 'k8s.io', 'images', 'tag', '--force', source, pinned]);
    images[snapshot.image] = pinned;
    if (repository === 'cs-task-runtime') {
      const pushTarget = `127.0.0.1:30500/crewstation/task-runtime:storage-${snapshot.id.slice(7)}`;
      await run(['docker', 'exec', node, 'ctr', '-n', 'k8s.io', 'images', 'tag', '--force', pinned, pushTarget]);
      await run(['docker', 'exec', node, 'ctr', '-n', 'k8s.io', 'images', 'push', '--plain-http', pushTarget]);
      taskImage = `${registry}/crewstation/task-runtime@${digest}`;
      await run(['docker', 'exec', node, 'ctr', '-n', 'k8s.io', 'images', 'tag', '--force', pinned, taskImage]);
    }
  }
  return { images, ...(taskImage ? { taskImage } : {}) };
}

export function importedManifestDigest(listing: string, source: string): string {
  const rows = listing.split('\n').map((line) => line.trim().split(/\s+/)).filter((parts) => parts[0] === source);
  const digest = rows[0]?.[2];
  if (rows.length !== 1 || !digest || !digestPattern.test(digest)) throw new Error('Imported image manifest identity is unavailable');
  return digest;
}
async function matchesCheckedImage(run: StorageGuardCommand, node: string, digest: string, id: string, depth = 0): Promise<boolean> {
  if (depth > 1) throw new Error('Unsupported image index nesting');
  const text = await run(['docker', 'exec', node, 'ctr', '-n', 'k8s.io', 'content', 'get', digest]);
  if (`sha256:${new Bun.CryptoHasher('sha256').update(text).digest('hex')}` !== digest) throw new Error('Imported manifest digest does not match its bytes');
  const value = JSON.parse(text) as { config?: { digest?: string }; manifests?: Array<{ digest: string }> };
  if (value.config?.digest === id || digest === id) return true;
  if (!value.manifests || value.manifests.length > 16) return false;
  for (const child of value.manifests) {
    if (!digestPattern.test(child.digest)) throw new Error('Invalid imported child manifest');
    if (await matchesCheckedImage(run, node, child.digest, id, depth + 1)) return true;
  }
  return false;
}

/** Preserve every other field, including unrelated system images and Secret references. */
export function pinStorageManifest(value: unknown, targets: StorageDeploymentTargets): unknown {
  if (Array.isArray(value)) return value.map((item) => pinStorageManifest(item, targets));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    key === 'image' && typeof item === 'string' && targets.images[item] ? targets.images[item]
      : key === 'CS_TASK_IMAGE' && targets.taskImage ? targets.taskImage : pinStorageManifest(item, targets)]));
}
async function importCheckedImage(tag: string, node: string): Promise<void> {
  const source = Bun.spawn(['docker', 'save', tag], { stdout: 'pipe', stderr: 'ignore' });
  const target = Bun.spawn(['docker', 'exec', '-i', node, 'ctr', '-n', 'k8s.io', 'images', 'import', '--digests', '-'], { stdin: source.stdout, stdout: 'ignore', stderr: 'ignore' });
  const results = await Promise.all([source.exited, target.exited]);
  if (results.some((code) => code !== 0)) throw new Error('Checked image import failed; deployment blocked');
}
if (import.meta.main) {
  const [mode, path, manifest] = process.argv.slice(2);
  if (!path) throw new Error('Usage: targets.ts bind <output.json> | render <targets.json> <manifest.yaml>');
  if (mode === 'bind') {
    const node = process.env.CREWSTATION_NODE_CONTAINER ?? 'desktop-control-plane';
    const images = ['cs-control-plane:dev', 'cs-console:dev', ...(process.env.CS_SKIP_TASK_RUNTIME === '1' ? [] : ['cs-task-runtime:dev'])];
    const checked = await storageDeploymentPreflight(runStorageGuardCommand, process.env.CS_SYSTEM_NAMESPACE ?? 'crewstation-system', images, process.env.CS_INSTALL_OBJECT_STORAGE === '1');
    requireCheckedTaskTarget(checked.requiredVersion, process.env.CS_INSTALL_OBJECT_STORAGE === '1', process.env.CS_SKIP_TASK_RUNTIME === '1');
    const targets = await bindStorageDeploymentTargets(runStorageGuardCommand, (tag) => importCheckedImage(tag, node), checked.images, node, process.env.CS_REGISTRY_BASE ?? 'registry.crewstation-system.svc.cluster.local:5000');
    await writeFile(path, JSON.stringify(targets), { flag: 'wx', mode: 0o600 });
  } else if (mode === 'task-image') {
    const targets = JSON.parse(await readFile(path, 'utf8')) as StorageDeploymentTargets;
    if (!targets.taskImage) throw new Error('No checked task image'); console.log(targets.taskImage);
  } else if (mode === 'render' && manifest) {
    const targets = JSON.parse(await readFile(path, 'utf8')) as StorageDeploymentTargets;
    const documents = Bun.YAML.parse(await readFile(manifest, 'utf8'));
    const items = (Array.isArray(documents) ? documents : [documents]).filter(Boolean).map((document) => pinStorageManifest(document, targets));
    console.log(JSON.stringify({ apiVersion: 'v1', kind: 'List', items }));
  } else throw new Error('Unknown deployment target operation');
}
