import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { nativeFixture, reviseNative } from '../../../packages/gitlab-client/native/fixture';
import { originalDockerGitlabDestructionObserver } from './destruction';

describe('fixed normal GitLab destruction host', () => {
  test('detached children, identity substitutions, native failure and replay are covered without touching the original project', () => {
    const result = Bun.spawnSync(['ruby', join(import.meta.dir, '../../../packages/gitlab-client/native/destruction/runner.test.rb')]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({ nativeDestructionCases: 18, nativeDatabasesOpened: false, originalProjectTouched: false });
  });
  test('only the fixed original native source and configured actor enter the command', async () => {
    const f = nativeFixture(), calls: { argv: string[]; input?: string }[] = [];
    const options = { containerId: f.instance.id, image: f.instance.image, startedAt: f.instance.startedAt, actorId: '1' };
    const observer = originalDockerGitlabDestructionObserver({ ...options, command: async (argv, _signal, input) => { calls.push({ argv, input }); return 'native'; } });
    options.actorId = '2';
    expect(await observer.run({ mode: 'observe', original: f.inventory }, AbortSignal.timeout(5000))).toBe('native');
    const call = calls[0]!;
    expect(call.argv.slice(0, 8)).toEqual(['docker', 'exec', '-i', '-e', 'CS_GITLAB_NATIVE_DESTRUCTION=1', f.instance.id, '/opt/gitlab/bin/gitlab-rails', 'runner']);
    expect(JSON.parse(call.input!).actorId).toBe('1'); expect(JSON.parse(call.input!).request.original).toEqual(f.inventory);
    const source = Buffer.from(call.argv[8]!.match(/Base64\.strict_decode64\("([A-Za-z0-9+/=]+)"\)/)![1]!, 'base64').toString();
    expect(source).toContain('Projects::DestroyService.new(row, actor).execute');
    expect(source).toContain('class Remaining'); expect(source).toContain('pluck(*fields)');
  });
  test('caller changes during a pending command do not replace the encoded birth', async () => {
    const f = nativeFixture(); let entered!: () => void, resume!: () => void, input = '';
    const begun = new Promise<void>(resolve => { entered = resolve; }), pause = new Promise<void>(resolve => { resume = resolve; });
    const observer = originalDockerGitlabDestructionObserver({ containerId: f.instance.id, image: f.instance.image, startedAt: f.instance.startedAt, actorId: '1',
      command: async (_argv, _signal, body) => { input = body!; entered(); await pause; return 'native'; } });
    const request = { mode: 'observe' as const, original: f.inventory }, pending = observer.run(request, AbortSignal.timeout(5000));
    await begun; request.original.project.id = '384'; reviseNative(request.original); resume();
    expect(await pending).toBe('native'); expect(JSON.parse(input).request.original.project.id).toBe('383');
  });
  test('invalid service actors, source instances and caller scopes cannot enter native execution', () => {
    const f = nativeFixture(), options = { containerId: f.instance.id, image: f.instance.image, startedAt: f.instance.startedAt, actorId: '1' };
    for (const actorId of ['', '0', '$(root)', '9007199254740992']) expect(() => originalDockerGitlabDestructionObserver({ ...options, actorId })).toThrow();
    expect(() => originalDockerGitlabDestructionObserver({ ...options, containerId: 'foreign' })).toThrow();
    const observer = originalDockerGitlabDestructionObserver(options);
    expect(() => observer.run({ mode: 'destroy', original: f.inventory }, AbortSignal.timeout(5000))).toThrow();
  });
});
