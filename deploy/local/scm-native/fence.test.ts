import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { nativeFixture } from '../../../packages/gitlab-client/native/fixture';
import { originalDockerGitlabFenceObserver } from './fence';

describe('fixed original native fence host', () => {
  test('native control flow rejects original identity replacement before any mutation and preserves replay', () => {
    const result = Bun.spawnSync(['ruby', join(import.meta.dir, '../../../packages/gitlab-client/native/fence/runner.test.rb')]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({ nativeControlFlowCases: 10, nativeDatabasesOpened: false, originalProjectTouched: false });
  });
  test('the configured actor is frozen outside the request and only the original fixed runner is used', async () => {
    const f = nativeFixture(), { archived: _archived, registryEnabled: _registry, ...project } = f.inventory.project;
    const request = { project, credentials: f.inventory.credentials }, calls: { argv: string[]; input?: string }[] = [];
    const options = { containerId: f.instance.id, image: f.instance.image, startedAt: f.instance.startedAt, actorId: '1' };
    const observer = originalDockerGitlabFenceObserver({ ...options, command: async (argv, _signal, input) => { calls.push({ argv, ...(input ? { input } : {}) }); return 'fenced'; } });
    options.actorId = '2'; expect(await observer.fence(request, AbortSignal.timeout(5000))).toBe('fenced');
    const call = calls[0]!;
    expect(call.argv.slice(0, 8)).toEqual(['docker', 'exec', '-i', '-e', 'CS_GITLAB_NATIVE_FENCE=1', f.instance.id, '/opt/gitlab/bin/gitlab-rails', 'runner']);
    expect(JSON.parse(call.input!).actorId).toBe('1'); expect(JSON.parse(call.input!).request.project).toEqual(project);
    expect(call.argv[8]).toContain('Base64.strict_decode64');
    const source = Buffer.from(call.argv[8]!.match(/Base64\.strict_decode64\("([A-Za-z0-9+/=]+)"\)/)![1]!, 'base64').toString();
    expect(source).toContain('Projects::DestroyService.new(project, actor).send(:mark_deletion_in_progress)');
    expect(source).toContain('Ci::AbortPipelinesService.new.execute');
    expect(source).not.toContain('CS_GITLAB_NATIVE_ERASE');
  });
  test('direct callers cannot mutate the encoded original scope during a pending native command', async () => {
    const f = nativeFixture(), { archived: _archived, registryEnabled: _registry, ...project } = f.inventory.project;
    const request = { project, credentials: f.inventory.credentials }; let entered!: () => void, resume!: () => void, input = '';
    const begun = new Promise<void>(resolve => { entered = resolve; }), pause = new Promise<void>(resolve => { resume = resolve; });
    const observer = originalDockerGitlabFenceObserver({ containerId: f.instance.id, image: f.instance.image, startedAt: f.instance.startedAt, actorId: '1',
      command: async (_argv, _signal, body) => { input = body!; entered(); await pause; return 'fenced'; } });
    const pending = observer.fence(request, AbortSignal.timeout(5000)); await begun; request.project.id = '384'; resume();
    expect(await pending).toBe('fenced'); expect(JSON.parse(input).request.project.id).toBe('383');
    expect(() => observer.fence({ ...request, project: { ...project, id: '$(foreign)' } }, AbortSignal.timeout(5000))).toThrow();
  });
  test('invalid configured actor or replacement container is never admitted', () => {
    const f = nativeFixture(), options = { containerId: f.instance.id, image: f.instance.image, startedAt: f.instance.startedAt, actorId: '1' };
    for (const actorId of ['', '0', '$(root)', '9007199254740992']) expect(() => originalDockerGitlabFenceObserver({ ...options, actorId })).toThrow();
    expect(() => originalDockerGitlabFenceObserver({ ...options, containerId: 'other' })).toThrow();
  });
});
