import { describe, expect, test } from 'bun:test';
import type { ClusterResult } from '../cluster/clusterAccess';
import type { InstallConfig } from '../cluster/installConfig';
import type { OperatorContext } from '../cluster/installReport';
import { PROBE_LABEL, judgeProbe, networkPolicyCheck, probeImage } from '../cluster/networkPolicyProbe';
import type { ReleaseBundle } from '../cluster/releaseBundle';
import { clusterOk, fakeCluster, memoryFiles, runForTest } from './cliHarness';

const IMAGE = 'registry.example.com/crewstation/control-plane@sha256:abc';
const NS = 'crewstation-preflight-t1';

function context(cluster: ReturnType<typeof fakeCluster>, images: readonly string[] = [IMAGE], dryRun = false): OperatorContext {
  return {
    config: {} as InstallConfig, bundle: { images } as ReleaseBundle, cluster, files: memoryFiles({}), client: undefined, dryRun,
  };
}

const probeScript = (overrides: Record<string, ClusterResult> = {}) => ({
  'apply -f -': clusterOk('applied\n'),
  [`-n ${NS} wait --for=condition=Ready pod/np-target`]: clusterOk(),
  [`-n ${NS} get pod np-target`]: clusterOk('10.244.130.7'),
  [`-n ${NS} wait --for=jsonpath`]: clusterOk(),
  [`-n ${NS} logs np-allowed`]: clusterOk('connected\n'),
  [`-n ${NS} logs np-denied`]: clusterOk('blocked\n'),
  [`delete namespace ${NS}`]: clusterOk(),
  ...overrides,
});

describe('探针镜像', () => {
  test('取发行包里名字以 control-plane 结尾的镜像；带不带仓库前缀、标签都认；没有就是 undefined', () => {
    expect(probeImage(['registry.example.com/crewstation/task-runtime@sha256:1', IMAGE])).toBe(IMAGE);
    expect(probeImage(['cs-control-plane:dev'])).toBe('cs-control-plane:dev');
    expect(probeImage(['registry.example.com/crewstation/console@sha256:2'])).toBeUndefined();
  });
});

describe('结论', () => {
  test('对照连得上、受限的连不上才算通过；受限的连得上是插件没执行；对照也连不上是网络本身不通', () => {
    expect(judgeProbe('connected\n', 'blocked\n').outcome).toBe('ok');
    expect(judgeProbe('connected\n', 'connected\n')).toMatchObject({ outcome: 'failed', detail: expect.stringContaining('网络插件没有执行 NetworkPolicy') });
    expect(judgeProbe('blocked\n', 'blocked\n')).toMatchObject({ outcome: 'failed', detail: expect.stringContaining('集群网络本身不通') });
  });
});

describe('实测过程', () => {
  test('下发应答端与禁止出站策略 → 等就绪 → 按应答端 IP 下发两个探针 → 读日志判定 → 删掉临时命名空间', async () => {
    const cluster = fakeCluster(probeScript());
    const result = await networkPolicyCheck(context(cluster), 't1');
    expect(result).toMatchObject({ outcome: 'ok', label: 'NetworkPolicy 实测（D60）' });
    expect(cluster.commands.map((c) => c.split(' ').slice(0, 4).join(' '))).toEqual([
      'apply -f -', `-n ${NS} wait --for=condition=Ready`, `-n ${NS} get pod`, 'apply -f -', `-n ${NS} wait --for=jsonpath={.status.phase}=Succeeded`,
      `-n ${NS} logs np-allowed`, `-n ${NS} logs np-denied`, `delete namespace ${NS} --wait=false`,
    ]);
    const target = JSON.parse(cluster.inputs['0']!) as { items: { kind: string; metadata: { name: string; namespace?: string }; spec?: Record<string, unknown> }[] };
    expect(target.items.map((item) => item.kind)).toEqual(['Namespace', 'NetworkPolicy', 'Pod']);
    expect(target.items[1]!.spec).toEqual({ podSelector: { matchLabels: { [PROBE_LABEL]: 'denied' } }, policyTypes: ['Egress'] });
    const clients = JSON.parse(cluster.inputs['3']!) as { items: { metadata: { name: string; labels: Record<string, string> }; spec: { containers: { image: string; env: { name: string; value: string }[] }[] } }[] };
    expect(clients.items.map((item) => [item.metadata.name, item.metadata.labels[PROBE_LABEL]])).toEqual([['np-allowed', 'allowed'], ['np-denied', 'denied']]);
    expect(clients.items[0]!.spec.containers[0]!.image).toBe(IMAGE);
    expect(clients.items.every((item) => (item.spec as { terminationGracePeriodSeconds?: number }).terminationGracePeriodSeconds === 1)).toBe(true);
    expect(clients.items[1]!.spec.containers[0]!.env).toContainEqual({ name: 'TARGET', value: 'http://10.244.130.7:8080/' });
  });

  test('受限探针也连得上：判失败，照样删掉临时命名空间', async () => {
    const cluster = fakeCluster(probeScript({ [`-n ${NS} logs np-denied`]: clusterOk('connected\n') }));
    const result = await networkPolicyCheck(context(cluster), 't1');
    expect(result.outcome).toBe('failed');
    expect(result.detail).toContain('网络插件没有执行 NetworkPolicy');
    expect(cluster.commands.at(-1)).toBe(`delete namespace ${NS} --wait=false --ignore-not-found`);
  });

  test('中途哪一步失败就停在哪一步，报出原因与临时命名空间，并清理', async () => {
    const cluster = fakeCluster(probeScript({ [`-n ${NS} wait --for=condition=Ready pod/np-target`]: { code: 1, stdout: '', stderr: 'error: timed out waiting for the condition\n' } }));
    const result = await networkPolicyCheck(context(cluster), 't1');
    expect(result).toMatchObject({ outcome: 'failed', detail: `等应答端就绪：error: timed out waiting for the condition（临时命名空间 ${NS}）` });
    expect(cluster.commands.filter((c) => c === 'apply -f -')).toHaveLength(1);
    expect(cluster.commands.at(-1)).toContain(`delete namespace ${NS}`);
  });

  test('发行包没有控制面镜像是待配置；--dry-run 只说明将做什么；两种都不碰集群', async () => {
    const none = fakeCluster({});
    expect((await networkPolicyCheck(context(none, ['registry.example.com/crewstation/console@sha256:2']), 't1')).outcome).toBe('pending-config');
    const dry = fakeCluster({});
    const planned = await networkPolicyCheck(context(dry, [IMAGE], true), 't1');
    expect(planned).toMatchObject({ outcome: 'skipped', detail: expect.stringContaining(NS) });
    expect([...none.commands, ...dry.commands]).toEqual([]);
  });
});

describe('预检有失败项就停下', () => {
  const INSTALL_YAML = [
    'profile: kind-dev', 'namespace: crewstation-system',
    'network: { consoleHost: console.cs.localhost, appsDomain: cs.localhost, previewDomain: cs.localhost, serviceDomain: svc.cs.internal, sourceIpPreserved: true }',
    'sourceControl: { baseUrl: "http://127.0.0.1:8929", groupId: "1" }', '',
  ].join('\n');
  const FILES = memoryFiles({ '/install.yaml': INSTALL_YAML, '/bundle/release.lock.yaml': `version: 0.2.0\nimages:\n  - ${IMAGE}\n` }, ['/bundle', '/bundle/migrations']);

  test('升级：网络插件不执行 NetworkPolicy 时预检失败，迁移与滚动都不执行，整体退出码 1', async () => {
    const cluster = fakeCluster({
      'version': clusterOk('{}'),
      '-n crewstation-system get deployments -o jsonpath': clusterOk('cs-api\ncs-session\n'),
      'apply -f -': clusterOk(),
      '-n crewstation-preflight-': clusterOk('connected\n'),
      'delete namespace crewstation-preflight-': clusterOk(),
      '-n crewstation-system rollout': clusterOk(),
    });
    const result = await runForTest(['upgrade', '--config', '/install.yaml', '--bundle', '/bundle', '--json'], { files: FILES, cluster });
    expect(result.code).toBe(1);
    expect(cluster.commands.some((c) => c.includes('rollout restart'))).toBe(false);
    const report = JSON.parse(result.out.join('\n')) as { phases: { id: string; checks: { label: string; outcome: string; detail: string }[] }[] };
    expect(report.phases.find((p) => p.id === 'preflight')!.checks.find((c) => c.label.includes('NetworkPolicy'))!.outcome).toBe('failed');
    expect(report.phases.filter((p) => p.id !== 'preflight').every((p) => p.checks.every((c) => c.outcome === 'skipped'))).toBe(true);
  });
});
