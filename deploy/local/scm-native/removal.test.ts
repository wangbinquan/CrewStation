import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { storageFixture } from '../../../packages/gitlab-client/native/storage/fixture';
import { originalDockerGitlabStorageRemovalObserver } from './removal';

describe('fixed original native storage remover host', () => {
  test('standalone native removal is covered on Linux and remains valid Ruby on development hosts', () => {
    const source = join(import.meta.dir, '../../../packages/gitlab-client/native/storage/');
    const result = Bun.spawnSync(process.platform === 'linux' ? ['ruby', source + 'remover.test.rb'] : ['ruby', '-c', source + 'remover.rb']);
    expect(result.exitCode).toBe(0);
    if (process.platform === 'linux') expect(JSON.parse(result.stdout.toString())).toEqual({ standaloneRemovalCases: 12,
      nativeDatabasesOpened: false, originalProjectTouched: false, foreignFilesPreserved: true });
    else expect(result.stdout.toString().trim()).toBe('Syntax OK');
  });
  test('only fixed standalone code and captured host roots reach the original container', async () => {
    const f = storageFixture(), roots = structuredClone(f.roots); let argv: string[] = [], input = '';
    const observer = originalDockerGitlabStorageRemovalObserver({ containerId: f.instance.id, image: f.instance.image, startedAt: f.instance.startedAt, roots: f.roots,
      command: async (command, _signal, body) => { argv = command; input = body!; return 'removed'; } });
    expect(await observer.remove({ original: f.inventory }, AbortSignal.timeout(5000))).toBe('removed');
    expect(JSON.parse(input).roots).toEqual(roots);
    expect(argv.slice(0, 7)).toEqual(['docker', 'exec', '-i', '-e', 'CS_GITLAB_STORAGE_REMOVE=1', f.instance.id, '/opt/gitlab/embedded/bin/ruby']);
    expect(argv).not.toContain('gitlab-rails');
    const source = Buffer.from(argv.at(-1)!.match(/strict_decode64\("([A-Za-z0-9+/=]+)"\)/)![1]!, 'base64').toString();
    expect(source).toContain('class Remover'); expect(source).toContain('File.unlink(path)');
    expect(source).not.toContain('Project.find');
    f.roots[0]!.path = '/var/opt/gitlab/foreign';
    expect(() => observer.remove({ original: f.inventory }, AbortSignal.timeout(5000))).toThrow();
  });
  test('a changed original root binding or invalid source container never runs the remover', () => {
    const f = storageFixture(), roots = structuredClone(f.roots);
    const observer = originalDockerGitlabStorageRemovalObserver({ containerId: f.instance.id, image: f.instance.image, startedAt: f.instance.startedAt, roots,
      command: async () => { throw Error('must not execute'); } });
    f.inventory.roots[0]!.identity!.birthtimeNs = '1';
    expect(() => observer.remove({ original: f.inventory }, AbortSignal.timeout(5000))).toThrow();
    expect(() => originalDockerGitlabStorageRemovalObserver({ containerId: 'other', image: f.instance.image, startedAt: f.instance.startedAt, roots })).toThrow();
  });
});
