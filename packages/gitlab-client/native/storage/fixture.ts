import { jsonHash } from '@crewstation/kernel';
import { nativeFixture } from '../fixture';
import type { GitLabStorageInventory, GitLabStorageRequest } from './protocol';

export function storageFixture() {
  const original = nativeFixture();
  const request: GitLabStorageRequest = { locations: [
    { key: 'original repository', root: 'repository', relative: '@hashed/original.git', mode: 'tree' },
    { key: 'original trace', root: 'trace', relative: '2026_09/383/9.log', mode: 'file' },
    { key: 'original missing artifact', root: 'artifact', relative: 'old/archive.zip', mode: 'file' },
  ] };
  const file = (path: string, kind: 'file' | 'directory', inode: string) => {
    const identity = { device: '65025', inode, birthtimeNs: '1787448382460933013', kind };
    return { ...identity, identity: jsonHash(identity), path, bytes: kind === 'file' ? 19 : 0, allocatedBytes: 4096,
      links: 1, mtimeNs: '1787448382460933013', ctimeNs: '1787448382460933013', mode: kind === 'file' ? 33188 : 16877 };
  };
  const locations = request.locations.map((location, index) => ({ ...location, present: index !== 2,
    entries: index === 0 ? [file(location.relative, 'directory', '701'), file(location.relative + '/objects/中文😊.pack', 'file', '18446744073709551615')]
      : index === 1 ? [file(location.relative, 'file', '702')] : [] }));
  const material = { roots: structuredClone(original.inventory.roots), locations };
  const inventory: GitLabStorageInventory = { ...material, version: 1, complete: true, readonly: true, observedAt: new Date().toISOString(),
    requestDigest: jsonHash(request), revision: jsonHash(material), runtime: structuredClone(original.inventory.runtime),
    physicalReclamationProven: false, producersClosed: false, consumersStopped: false };
  return { instance: original.instance, request, inventory, roots: inventory.roots };
}
export function reviseStorage(inventory: GitLabStorageInventory) {
  inventory.revision = jsonHash({ roots: inventory.roots, locations: inventory.locations });
}
