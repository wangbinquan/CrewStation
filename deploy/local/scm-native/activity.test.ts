import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { jsonHash } from '../../../packages/kernel';
import { nativeFixture } from '../../../packages/gitlab-client/native/fixture';
import { originalDockerGitlabActivityObserver } from './activity';

function fixture(change?: (material: { source: { bootId: string; namespace: string }; processes: { pid: number; uid: string; startedTick: string }[] }, stage: string) => void) {
  const f = nativeFixture(), source = { bootId: f.inventory.runtime.bootId, namespace: f.inventory.runtime.namespace };
  const processes = [{ pid: 1, uid: '0', startedTick: '1' }, { pid: 7, uid: '998', startedTick: '11' }];
  const request = { original: f.inventory, identities: [{ device: '65025', inode: '9' }] }, commands: string[][] = [], inputs: unknown[] = [];
  let manifests = 0;
  const observer = originalDockerGitlabActivityObserver({ containerId: f.instance.id, image: f.instance.image, startedAt: f.instance.startedAt, command: async (argv, _signal, input) => {
    const query = JSON.parse(input!); commands.push(argv); inputs.push(query);
    if (query.mode === 'manifest') {
      change?.({ source, processes }, ++manifests === 1 ? 'before' : 'after');
      return 'CS_GITLAB_CONSUMERS=' + JSON.stringify({ version: 1, source, processes, revision: jsonHash({ source, processes }) });
    }
    if (query.mode === 'consume') {
      const uid = argv[argv.indexOf('--user') + 1]!; change?.({ source, processes }, uid);
      return 'CS_GITLAB_CONSUMERS=' + JSON.stringify({ version: 1, source, uid, originalRevision: query.original.revision, identitiesDigest: jsonHash(query.identities),
        consumers: uid === '998' ? [{ pid: 7, tid: 8, startedTick: '11', kind: 'descriptor', device: '65025', inode: '9' }] : [] });
    }
    return 'CS_GITLAB_ACTIVITY=source-result';
  } });
  return { ...f, request, observer, commands, inputs };
}
describe('native process account routing', () => {
  test('fixed producer parsing never turns unavailable or inconsistent counters into zero', () => {
    const result = spawnSync('ruby', [import.meta.dir + '/../../../packages/gitlab-client/native/activity/runner.test.rb'], { encoding: 'utf8' });
    expect(result.status).toBe(0); expect(JSON.parse(result.stdout)).toEqual({ standaloneActivityCases: 8, originalProjectTouched: false });
  });
  test('Linux temporary descriptors, unlinked bytes, mappings, cwd, executable and birth changes are checked', () => {
    const result = spawnSync('ruby', [...(process.platform === 'linux' ? [] : ['-c']), import.meta.dir + '/../../../packages/gitlab-client/native/activity/consumers.test.rb'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    if (process.platform === 'linux') expect(JSON.parse(result.stdout)).toEqual({ standaloneConsumerCases: 8, originalProjectTouched: false });
    else expect(result.stdout).toContain('Syntax OK');
  });
  test('every original process account is read with fixed Ruby and full manifest is verified before Rails', async () => {
    const f = fixture(), original = structuredClone(f.request), pending = f.observer.read(f.request, AbortSignal.timeout(1000)); f.request.original.project.id = '999';
    expect(await pending).toBe('CS_GITLAB_ACTIVITY=source-result'); expect(f.commands).toHaveLength(5);
    expect(f.commands.slice(0, 4).map(argv => argv[argv.indexOf('--user') + 1])).toEqual(['0', '0', '998', '0']);
    const supplied = f.inputs.at(-1) as { original: unknown; consumerReport: { consumers: unknown[] } };
    expect(supplied.original).toEqual(original.original); expect(supplied.consumerReport.consumers).toHaveLength(1);
    for (const argv of f.commands) { expect(argv).toContain(f.instance.id); expect(argv.at(-1)).not.toContain('65025'); }
    expect(f.commands.at(-1)).toContain('CS_GITLAB_NATIVE_READ=0'); expect(f.commands.at(-1)).toContain('CS_GITLAB_ACTIVITY_READ=1');
  });
  test('a substituted account, namespace or original process manifest stops before any native producer query', async () => {
    for (const change of [
      (value: Parameters<NonNullable<Parameters<typeof fixture>[0]>>[0], stage: string) => { if (stage === 'before') value.source.namespace = 'pid:[18]'; },
      (value: Parameters<NonNullable<Parameters<typeof fixture>[0]>>[0], stage: string) => { if (stage === 'after') value.processes[1]!.startedTick = '99'; },
      (value: Parameters<NonNullable<Parameters<typeof fixture>[0]>>[0], stage: string) => { if (stage === 'before') value.processes[1]!.uid = '998;command'; },
    ]) { const f = fixture(change); await expect(f.observer.read(f.request, AbortSignal.timeout(1000))).rejects.toThrow(); expect(f.commands.flat()).not.toContain('CS_GITLAB_ACTIVITY_READ=1'); }
  });
});
