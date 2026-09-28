import { expect, test } from 'bun:test';
import { storageContractCommand } from './storageContract';

test('Runner and archive-helper negotiate before business config and refuse unsupported versions or platforms', () => {
  for (const name of ['task-runner', 'archive-helper'] as const) {
    expect(storageContractCommand(['storage-contract', '1'], name, { platform: 'linux', arch: 'arm64' })).toEqual({ name, storageContractVersion: 1 });
    expect(storageContractCommand([], name)).toBeUndefined();
    for (const args of [['storage-contract'], ['storage-contract', '2'], ['storage-contract', '1', 'ignored']]) expect(() => storageContractCommand(args, name, { platform: 'linux', arch: 'x64' })).toThrow();
    expect(() => storageContractCommand(['storage-contract', '1'], name, { platform: 'darwin', arch: 'arm64' })).toThrow('Linux');
  }
});
