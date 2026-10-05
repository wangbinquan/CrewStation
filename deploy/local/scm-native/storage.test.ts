import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { storageFixture } from '../../../packages/gitlab-client/native/storage/fixture';
import { originalDockerGitlabStorageObserver } from './storage';

describe('host binding of retained GitLab storage roots', () => {
  test('the reader is fixed Ruby code and the original roots stay outside caller-controlled scope', async () => {
    const f = storageFixture(), before = structuredClone(f.roots); let argv: string[] = [], input = '';
    const observer = originalDockerGitlabStorageObserver({ containerId: f.instance.id, image: f.instance.image, startedAt: f.instance.startedAt, roots: f.roots,
      command: async (command, _signal, stdin) => { argv = command; input = stdin!; return 'source-result'; } });
    f.roots[0]!.path = '/var/opt/gitlab/foreign';
    expect(await observer.read(f.request, AbortSignal.timeout(1000))).toBe('source-result');
    expect(JSON.parse(input)).toEqual({ roots: before, request: f.request });
    expect(argv).toContain(f.instance.id); expect(argv).toContain('CS_GITLAB_STORAGE_READ=1');
    expect(argv).not.toContain('gitlab-rails');
    const script = argv.at(-1)!, encoded = script.match(/strict_decode64\("([A-Za-z0-9+/=]+)"\)/)![1]!;
    expect(Buffer.from(encoded, 'base64').toString()).toBe(readFileSync(import.meta.dir + '/../../../packages/gitlab-client/native/storage/reader.rb', 'utf8'));
    expect(script).not.toContain('@hashed/original.git');
    expect(() => observer.read({ locations: [{ ...f.request.locations[0]!, relative: '../foreign' }] }, AbortSignal.timeout(1000))).toThrow();
    expect(() => observer.read({ locations: Array.from({ length: 128 }, (_, i) => ({ key: String(i), root: 'repository', relative: 'x'.repeat(4000), mode: 'tree' })) }, AbortSignal.timeout(1000))).toThrow('native-source-storage-request-budget');
  });
  test('combined configuration budget also bounds captured original root names', () => {
    const f = storageFixture();
    for (const root of f.roots) { root.path = '/var/opt/gitlab/' + 'x'.repeat(3980); root.configuredPath = '/' + 'y'.repeat(3980); }
    const observer = originalDockerGitlabStorageObserver({ containerId: f.instance.id, image: f.instance.image, startedAt: f.instance.startedAt, roots: f.roots, command: async () => { throw Error('must not execute'); } });
    const request = { locations: Array.from({ length: 6 }, (_, i) => ({ key: String(i), root: 'repository' as const, relative: 'x'.repeat(2000), mode: 'tree' as const })) };
    expect(() => observer.read(request, AbortSignal.timeout(1000))).toThrow('native-source-storage-config-budget');
  });
});
