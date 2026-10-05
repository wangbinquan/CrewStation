import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { originalDockerGitlabObserver } from './observer';
import { nativeSourceCommand } from './process';
import { nativeFixture } from '../../../packages/gitlab-client/native/fixture';

const signal = () => AbortSignal.timeout(5000);
const run = (code: string, input?: string, abort = signal()) => nativeSourceCommand([process.execPath, '-e', code], abort, input);
describe('original SCM host source commands', () => {
  test('the child receives exact JSON on stdin and returns only stdout', async () => {
    const input = '{"path":"group/$(foreign);`other`","tokenIds":["513"]}';
    expect(await run('process.stderr.write("diagnostic"); process.stdout.write(await Bun.stdin.text());', input)).toBe(input);
    expect(await run('process.stdout.write("empty-input:" + await Bun.stdin.text());')).toBe('empty-input:');
  });
  test('oversized output, invalid UTF-8 and raw child errors cannot become a successful source', async () => {
    for (const code of ['process.stdout.write(Buffer.alloc(8_388_609));', 'process.stderr.write(Buffer.alloc(8193));'])
      await expect(run(code)).rejects.toThrow('native-source-output-budget');
    await expect(run('process.stdout.write(Buffer.from([255]));')).rejects.toThrow();
    await expect(run('process.stderr.write("private contents must never escape");process.exit(1);')).rejects.toThrow('native-source-command-unavailable');
    await expect(run('process.stderr.write("native-source-unsupported:registry secret");process.exit(1);')).rejects.toThrow('native-source-unsupported:registry');
  });
  test('pre-abort prevents spawning and live abort terminates the host child promptly', async () => {
    await expect(run('throw Error("must not run")', '', AbortSignal.abort())).rejects.toThrow();
    await expect(nativeSourceCommand(['missing-native-source-executable'], signal())).rejects.toThrow();
    const abort = new AbortController(), pending = run('setInterval(() => {}, 10);', '', abort.signal);
    const deadline = setTimeout(() => abort.abort(), 30);
    try { await expect(pending).rejects.toThrow(); } finally { clearTimeout(deadline); }
  });
  test('Docker identity, namespace and reader asset belong to the pinned original installation', async () => {
    const f = nativeFixture(), calls: { argv: string[]; input?: string }[] = [];
    const options = { containerId: f.instance.id, image: f.instance.image, startedAt: f.instance.startedAt };
    const observer = originalDockerGitlabObserver({ ...options, command: async (argv, _signal, input) => {
      calls.push({ argv, input });
      if (argv[1] === 'inspect') return [f.instance.id, f.instance.image, f.instance.startedAt, true].map(value => JSON.stringify(value)).join(' ') + '\n';
      if (argv.includes('-rjson')) return JSON.stringify({ bootId: f.inventory.runtime.bootId, namespace: f.inventory.runtime.namespace });
      return 'CS_GITLAB_NATIVE=' + JSON.stringify(f.inventory);
    } });
    options.containerId = 'c'.repeat(64);
    expect(await observer.inspect(signal())).toEqual(f.instance);
    expect(await observer.read(f.request, signal())).toStartWith('CS_GITLAB_NATIVE=');
    expect(calls[0]!.argv.at(-1)).toBe(f.instance.id);
    expect(calls[2]!.argv).toContain(f.instance.id); expect(calls[2]!.input).toBe(JSON.stringify(f.request));
    const script = calls[2]!.argv.at(-1)!, encoded = script.match(/strict_decode64\("([A-Za-z0-9+/=]+)"\)/)![1]!;
    expect(Buffer.from(encoded, 'base64').toString()).toBe(readFileSync(import.meta.dir + '/../../../packages/gitlab-client/native/reader.rb', 'utf8'));
    expect(script).not.toContain(f.request.pathWithNamespace);
    expect(script).not.toContain('513');
    expect(calls[2]!.argv).toContain('CS_GITLAB_NATIVE_READ=1');
  });
  test('replacement identities and malformed runtime facts fail before the query', async () => {
    const f = nativeFixture(), original = { containerId: f.instance.id, image: f.instance.image, startedAt: f.instance.startedAt };
    for (const change of ['id', 'image', 'birth', 'stopped', 'format', 'namespace', 'boot', 'runtime']) {
      const observer = originalDockerGitlabObserver({ ...original, command: async argv => {
        if (argv[1] === 'inspect') return change === 'format' ? '{}' : [change === 'id' ? 'c'.repeat(64) : original.containerId,
          change === 'image' ? 'sha256:' + 'c'.repeat(64) : original.image, change === 'birth' ? '2026-10-02T00:00:00Z' : original.startedAt,
          change !== 'stopped'].map(value => JSON.stringify(value)).join(' ');
        if (change === 'runtime') return '{}';
        return JSON.stringify({ bootId: change === 'boot' ? 'bad' : f.inventory.runtime.bootId, namespace: change === 'namespace' ? 'pid:[0]' : f.inventory.runtime.namespace });
      } });
      await expect(observer.inspect(signal())).rejects.toThrow();
    }
    for (const change of ['containerId', 'image', 'startedAt']) expect(() => originalDockerGitlabObserver({ ...original, [change]: 'bad' })).toThrow();
  });
  test('direct native reads validate and freeze their bounded project scope before executing', async () => {
    const f = nativeFixture(); let entered!: () => void, finish!: () => void, received = '';
    const begun = new Promise<void>(resolve => { entered = resolve; }), paused = new Promise<void>(resolve => { finish = resolve; });
    const observer = originalDockerGitlabObserver({ containerId: f.instance.id, image: f.instance.image, startedAt: f.instance.startedAt,
      command: async (_argv, _signal, input) => { received = input!; entered(); await paused; return 'result'; } });
    const pending = observer.read(f.request, signal()); await begun; f.request.projectId = '384'; finish();
    expect(await pending).toBe('result'); expect(JSON.parse(received).projectId).toBe('383');
    expect(() => observer.read({ ...f.request, projectId: '$(other)' }, signal())).toThrow();
    expect(() => observer.read({ ...f.request, tokenIds: Array.from({ length: 10_000 }, (_, i) => String(i + 1)) }, signal())).toThrow('native-source-request-budget');
  });
});
