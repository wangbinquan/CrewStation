import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { nativeFixture, reviseNative } from '../../../packages/gitlab-client/native/fixture';
import { originalDockerGitlabFootprintObserver } from './footprint';

describe('fixed host footprint source', () => {
  test('the fixed Ruby locator validates complete prefixes and foreign retention in Linux temporary directories', () => {
    const result = spawnSync('ruby', [...(process.platform === 'linux' ? [] : ['-c']), import.meta.dir + '/../../../packages/gitlab-client/native/storage/locator.test.rb'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    if (process.platform === 'linux') expect(JSON.parse(result.stdout)).toEqual({ standaloneFootprintCases: 14, originalProjectTouched: false, foreignFilesRetained: true });
    else expect(result.stdout).toContain('Syntax OK');
  });
  test('the original roots and input are frozen and only the independent metadata Ruby source executes', async () => {
    const f = nativeFixture(), roots = structuredClone(f.inventory.roots); let argv: string[] = [], stdin = '';
    const observer = originalDockerGitlabFootprintObserver({ containerId: f.instance.id, image: f.instance.image, startedAt: f.instance.startedAt, roots: f.inventory.roots,
      command: async (command, _signal, input) => { argv = command; stdin = input!; return 'source-output'; } });
    const pending = observer.read({ original: f.inventory }, AbortSignal.timeout(1000)); f.inventory.project.id = '999'; f.inventory.roots[0]!.path = '/var/opt/gitlab/foreign';
    expect(await pending).toBe('source-output'); expect(JSON.parse(stdin).roots).toEqual(roots); expect(JSON.parse(stdin).original.project.id).toBe('383');
    expect(argv).toContain('CS_GITLAB_STORAGE_READ=0'); expect(argv).toContain('CS_GITLAB_FOOTPRINT_READ=1'); expect(argv).toContain(f.instance.id);
    expect(argv).not.toContain('gitlab-rails'); expect(argv.at(-1)).not.toContain('@hashed/original');
    const encoded = argv.at(-1)!.match(/strict_decode64\("([A-Za-z0-9+/=]+)"\)/)![1]!;
    const expected = ['reader.rb', 'locator.rb'].map(file => readFileSync(import.meta.dir + '/../../../packages/gitlab-client/native/storage/' + file, 'utf8')).join('\n');
    expect(Buffer.from(encoded, 'base64').toString()).toBe(expected);
    expect(() => observer.read({ original: f.inventory }, AbortSignal.timeout(1000))).toThrow();
    f.inventory.roots = roots; reviseNative(f.inventory);
    expect(() => observer.read({ original: f.inventory, command: 'arbitrary' } as never, AbortSignal.timeout(1000))).toThrow();
  });
});
