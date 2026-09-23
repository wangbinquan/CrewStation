import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClusterOps, TaskResource } from './platform-admin-session';
import type { Kube, PodList, PodRow, Workload } from './rebuild-old-range-pods';
import { kubectlAdapter, main, oldRangePods, parsePods, planRebuild, rebuildOldRangePods, taskAction, workloadOf } from './rebuild-old-range-pods';

const PREFIX = '10.244.0.';

interface FakePod {
  namespace: string; name: string; uid: string; ip: string; phase?: string; ready?: boolean; terminating?: boolean; hostNetwork?: boolean;
  owner?: { kind: string; name: string }; hash?: string;
}

const raw = (pod: FakePod) => ({
  metadata: {
    namespace: pod.namespace, name: pod.name, uid: pod.uid, ...(pod.terminating ? { deletionTimestamp: '2026-09-23T10:00:00Z' } : {}),
    ...(pod.hash ? { labels: { 'pod-template-hash': pod.hash } } : {}), ...(pod.owner ? { ownerReferences: [{ ...pod.owner, controller: true }] } : {}),
  },
  spec: pod.hostNetwork ? { hostNetwork: true } : {},
  status: { podIP: pod.ip, phase: pod.phase ?? 'Running', conditions: [{ type: 'Ready', status: pod.ready === false ? 'False' : 'True' }] },
});
const rows = (pods: FakePod[]): PodRow[] => parsePods({ items: pods.map(raw) } as PodList);

/**
 * 假集群：删掉的 Pod 带上 deletionTimestamp 留在列表里；有控制器的，在之后第 lag 次列 Pod 时出现一个新网段上就绪的替身。
 * never 里点名的工作负载永远不出替身，用来测超时。
 */
class FakeCluster {
  readonly deleted: string[] = [];
  private polls = 0;
  private next = 1;
  private readonly pending: { at: number; pod: FakePod }[] = [];
  constructor(readonly pods: FakePod[], private readonly lag = 1, private readonly never: readonly string[] = []) {}
  kube(): Kube {
    return {
      pods: async () => {
        this.polls += 1;
        for (const item of this.pending.filter((p) => p.at <= this.polls)) { this.pods.push(item.pod); this.pending.splice(this.pending.indexOf(item), 1); }
        return { items: this.pods.map(raw) } as PodList;
      },
      deletePod: async (namespace, name) => {
        const pod = this.pods.find((p) => p.namespace === namespace && p.name === name && !p.terminating)!;
        pod.terminating = true;
        this.deleted.push(`${namespace}/${name}`);
        if (pod.owner && !this.never.includes(pod.owner.name)) this.replace(pod, this.polls + this.lag);
      },
      desiredReplicas: async (workload: Workload) => this.pods.filter((p) => p.owner && workloadOf(rows([p])[0]!)?.name === workload.name && p.namespace === workload.namespace).length,
    };
  }
  replace(pod: FakePod, at: number): void {
    const n = this.next++;
    const name = pod.owner?.kind === 'StatefulSet' ? pod.name : `${pod.owner?.name ?? pod.name}-new${n}`;
    this.pending.push({ at, pod: { ...pod, name, uid: `${pod.uid}-r${n}`, ip: `10.244.130.${n}`, terminating: false, ready: true } });
  }
}

/** 假的集群管理：按 uid 找资源；执行时模拟领域的效果（重启会话收走它的 CLI、换出新会话 Pod；删除只打终止标记）。 */
function fakeOps(cluster: FakeCluster, resources: Record<string, TaskResource>) {
  const calls: string[] = [];
  const ops: ClusterOps = {
    findPod: async (pod) => resources[pod.uid],
    run: async (resource, action, key) => {
      calls.push(`${action} ${resource.purpose} ${key}`);
      const pod = cluster.pods.find((p) => p.uid === resource.uid)!;
      pod.terminating = true;
      if (resource.purpose === 'development-workspace' && action === 'restart') {
        cluster.replace({ ...pod, owner: undefined }, 0);
        for (const child of Object.values(resources).filter((r) => r.parentTaskId === resource.taskId)) cluster.pods.find((p) => p.uid === child.uid)!.terminating = true;
      }
      return { phase: 'succeeded', reason: '' };
    },
  };
  return { ops, calls };
}

const resource = (uid: string, purpose: string, extra: Partial<TaskResource> = {}): TaskResource => ({
  resourceId: `res-${uid}`, uid, purpose, availableActions: [{ action: 'restart', enabled: true, reason: '' }, { action: 'delete', enabled: true, reason: '' }], ...extra,
});

function clock() {
  let now = 0;
  return { now: () => now, sleep: async (ms: number) => { now += ms; } };
}

describe('旧网段判定与分批', () => {
  test('只算还在用网络的旧地址 Pod：跳过 hostNetwork、正在终止的与已经结束的，Pending 的算', () => {
    const pods = rows([
      { namespace: 'a', name: 'running', uid: '1', ip: '10.244.0.5' },
      { namespace: 'a', name: 'pending', uid: '2', ip: '10.244.0.6', phase: 'Pending' },
      { namespace: 'a', name: 'host', uid: '3', ip: '10.244.0.2', hostNetwork: true },
      { namespace: 'a', name: 'leaving', uid: '4', ip: '10.244.0.7', terminating: true },
      { namespace: 'a', name: 'done', uid: '5', ip: '10.244.0.8', phase: 'Succeeded' },
      { namespace: 'a', name: 'calico', uid: '6', ip: '10.244.130.9' },
    ]);
    expect(oldRangePods(pods, PREFIX).map((p) => p.name)).toEqual(['running', 'pending']);
  });

  test('工作负载：ReplicaSet 按 pod-template-hash 还原成 Deployment；StatefulSet、DaemonSet 原样；Job 与对不上的 ReplicaSet 不等', () => {
    const [deployment, statefulSet, daemonSet, job, stray] = rows([
      { namespace: 'n', name: 'cs-api-7f9-x', uid: '1', ip: '', owner: { kind: 'ReplicaSet', name: 'cs-api-7f9' }, hash: '7f9' },
      { namespace: 'n', name: 'postgres-0', uid: '2', ip: '', owner: { kind: 'StatefulSet', name: 'postgres' } },
      { namespace: 'n', name: 'probe-x', uid: '3', ip: '', owner: { kind: 'DaemonSet', name: 'probe' } },
      { namespace: 'n', name: 'migrate-x', uid: '4', ip: '', owner: { kind: 'Job', name: 'migrate' } },
      { namespace: 'n', name: 'odd-x', uid: '5', ip: '', owner: { kind: 'ReplicaSet', name: 'odd' }, hash: 'abc' },
    ]);
    expect(workloadOf(deployment!)).toEqual({ namespace: 'n', kind: 'Deployment', name: 'cs-api' });
    expect(workloadOf(statefulSet!)).toEqual({ namespace: 'n', kind: 'StatefulSet', name: 'postgres' });
    expect(workloadOf(daemonSet!)).toEqual({ namespace: 'n', kind: 'DaemonSet', name: 'probe' });
    expect(workloadOf(job!)).toBeUndefined();
    expect(workloadOf(stray!)).toBeUndefined();
  });

  test('按依赖分四批：系统组件 → 平台底座 → 网关与平台服务 → 各项目；没有控制器的是任务 Pod；同一工作负载只记一次', () => {
    const plan = planRebuild(rows([
      { namespace: 'kube-system', name: 'coredns-abc-1', uid: '1', ip: '', owner: { kind: 'ReplicaSet', name: 'coredns-abc' }, hash: 'abc' },
      { namespace: 'kube-system', name: 'coredns-abc-2', uid: '2', ip: '', owner: { kind: 'ReplicaSet', name: 'coredns-abc' }, hash: 'abc' },
      { namespace: 'local-path-storage', name: 'lp-1-x', uid: '3', ip: '', owner: { kind: 'ReplicaSet', name: 'lp-1' }, hash: '1' },
      { namespace: 'crewstation-system', name: 'postgres-0', uid: '4', ip: '', owner: { kind: 'StatefulSet', name: 'postgres' } },
      { namespace: 'crewstation-system', name: 'registry-9-x', uid: '5', ip: '', owner: { kind: 'ReplicaSet', name: 'registry-9' }, hash: '9' },
      { namespace: 'crewstation-system', name: 'cs-api-7-x', uid: '6', ip: '', owner: { kind: 'ReplicaSet', name: 'cs-api-7' }, hash: '7' },
      { namespace: 'cs-demo', name: 'demo-blue-5-x', uid: '7', ip: '', owner: { kind: 'ReplicaSet', name: 'demo-blue-5' }, hash: '5' },
      { namespace: 'cs-demo', name: 'task-r-1', uid: '8', ip: '' },
    ]));
    expect(plan.waves.map((w) => w.pods.map((p) => p.uid))).toEqual([['1', '2', '3'], ['4', '5'], ['6'], ['7']]);
    expect(plan.waves[0]!.workloads.map((w) => w.name)).toEqual(['coredns', 'lp']);
    expect(plan.tasks.map((p) => p.uid)).toEqual(['8']);
  });
});

describe('任务 Pod 的处理方式', () => {
  const none = new Set<string>();
  test('开发会话重启；会话已重启时它的 CLI 与历史 Agent 随之结束；会话没动时 CLI 自己重启', () => {
    expect(taskAction(resource('w', 'development-workspace'), none)).toEqual({ kind: 'run', action: 'restart' });
    expect(taskAction(resource('c', 'development-cli', { parentTaskId: 'env-1' }), new Set(['env-1']))).toEqual({ kind: 'follow' });
    expect(taskAction(resource('a', 'development-agent', { parentTaskId: 'env-1' }), new Set(['env-1']))).toEqual({ kind: 'follow' });
    expect(taskAction(resource('c', 'development-cli', { parentTaskId: 'env-2' }), new Set(['env-1']))).toEqual({ kind: 'run', action: 'restart' });
  });

  test('业务任务能重启就重启、否则删除；档位测试删除；集群管理不允许时带上它给的理由跳过', () => {
    const noRestart = [{ action: 'restart', enabled: false, reason: '一次性子任务不能重启' }, { action: 'delete', enabled: true, reason: '' }];
    expect(taskAction(resource('b', 'business-subtask'), none)).toEqual({ kind: 'run', action: 'restart' });
    expect(taskAction(resource('b', 'business-subtask', { availableActions: noRestart }), none)).toEqual({ kind: 'run', action: 'delete' });
    expect(taskAction(resource('p', 'profile-test'), none)).toEqual({ kind: 'run', action: 'delete' });
    expect(taskAction(resource('w', 'development-workspace', { availableActions: [{ action: 'restart', enabled: false, reason: '会话正在恢复' }] }), none)).toEqual({ kind: 'skip', reason: '会话正在恢复' });
  });

  test('盘点里找不到、或用途不归迁移处理的，跳过并说明', () => {
    expect(taskAction(undefined, none)).toEqual({ kind: 'skip', reason: '集群管理的盘点里找不到它' });
    expect(taskAction(resource('s', 'digital-worker-service'), none)).toEqual({ kind: 'skip', reason: '用途 digital-worker-service 不由迁移处理' });
  });
});

function demoCluster(lag = 1, never: string[] = []) {
  return new FakeCluster([
    { namespace: 'kube-system', name: 'coredns-abc-1', uid: 'k1', ip: '10.244.0.3', owner: { kind: 'ReplicaSet', name: 'coredns-abc' }, hash: 'abc' },
    { namespace: 'kube-system', name: 'coredns-abc-2', uid: 'k2', ip: '10.244.0.4', owner: { kind: 'ReplicaSet', name: 'coredns-abc' }, hash: 'abc' },
    { namespace: 'crewstation-system', name: 'postgres-0', uid: 'p1', ip: '10.244.0.10', owner: { kind: 'StatefulSet', name: 'postgres' } },
    { namespace: 'crewstation-system', name: 'cs-api-7-x', uid: 'a1', ip: '10.244.0.11', owner: { kind: 'ReplicaSet', name: 'cs-api-7' }, hash: '7' },
    { namespace: 'cs-demo', name: 'demo-blue-5-x', uid: 'd1', ip: '10.244.0.20', owner: { kind: 'ReplicaSet', name: 'demo-blue-5' }, hash: '5' },
    { namespace: 'cs-demo', name: 'task-cli', uid: 't2', ip: '10.244.0.22' },
    { namespace: 'cs-demo', name: 'task-r-ws', uid: 't1', ip: '10.244.0.21' },
    { namespace: 'cs-biz', name: 'task-biz', uid: 't3', ip: '10.244.0.23' },
    { namespace: 'cs-x', name: 'stray', uid: 't4', ip: '10.244.0.24' },
    { namespace: 'kube-system', name: 'kube-proxy', uid: 'h1', ip: '10.244.0.2', hostNetwork: true },
  ], lag, never);
}
const demoResources: Record<string, TaskResource> = {
  t1: resource('t1', 'development-workspace', { taskId: 'env-1' }),
  t2: resource('t2', 'development-cli', { taskId: 'cli-1', parentTaskId: 'env-1' }),
  t3: resource('t3', 'business-subtask', { availableActions: [{ action: 'restart', enabled: false, reason: '一次性子任务' }, { action: 'delete', enabled: true, reason: '' }] }),
  t4: resource('t4', 'unknown'),
};

describe('按计划重建', () => {
  test('四批依次删、每批等替身就绪；任务 Pod 先重启会话、CLI 随会话结束、业务任务删除；处理不了的留下并返回', async () => {
    const cluster = demoCluster(), { ops, calls } = fakeOps(cluster, demoResources), lines: string[] = [], time = clock();
    const left = await rebuildOldRangePods({ kube: cluster.kube(), ops: async () => ops, prefix: PREFIX, log: (l) => lines.push(l), ...time });
    expect(cluster.deleted).toEqual(['kube-system/coredns-abc-1', 'kube-system/coredns-abc-2', 'crewstation-system/postgres-0', 'crewstation-system/cs-api-7-x', 'cs-demo/demo-blue-5-x']);
    expect(calls).toEqual(['restart development-workspace calico-migration:t1:restart', 'delete business-subtask calico-migration:t3:delete']);
    expect(lines).toContain('  cs-demo task-cli（development-cli） 随所在的开发会话结束');
    expect(lines).toContain('  跳过 cs-x stray（unknown）：用途 unknown 不由迁移处理');
    expect(left.map((p) => p.name)).toEqual(['stray']);
    // 跳过的 stray 不在等待之列：没有白等到超时。
    expect(time.now()).toBeLessThan(60_000);
  });

  test('替身一直不就绪：这一批等到超时就停，后面的批次不动', async () => {
    const cluster = demoCluster(1, ['postgres']), { ops, calls } = fakeOps(cluster, demoResources), time = clock();
    const outcome = rebuildOldRangePods({ kube: cluster.kube(), ops: async () => ops, prefix: PREFIX, log: () => {}, waveTimeoutMs: 20_000, ...time });
    await expect(outcome).rejects.toThrow('等待超时：crewstation-system/StatefulSet/postgres 就绪 0/1');
    expect(cluster.deleted).not.toContain('crewstation-system/cs-api-7-x');
    expect(calls).toEqual([]);
  });

  test('以管理员身份登录不了：有控制器的照样重建，任务 Pod 逐个列出、留在旧地址上', async () => {
    const cluster = demoCluster(), lines: string[] = [];
    const left = await rebuildOldRangePods({ kube: cluster.kube(), ops: async () => { throw new Error('口令登录：HTTP 403'); }, prefix: PREFIX, log: (l) => lines.push(l), ...clock() });
    expect(cluster.deleted).toHaveLength(5);
    expect(lines).toContain('  无法以管理员身份使用集群管理（口令登录：HTTP 403），这些任务 Pod 留在旧地址上：');
    expect(left.map((p) => p.name).sort()).toEqual(['stray', 'task-biz', 'task-cli', 'task-r-ws']);
  });

  test('--dry-run 只列计划：不删 Pod、不执行运维操作，但照样查出每个任务 Pod 会怎么处理', async () => {
    const cluster = demoCluster(), { ops, calls } = fakeOps(cluster, demoResources), lines: string[] = [];
    const left = await rebuildOldRangePods({ kube: cluster.kube(), ops: async () => ops, prefix: PREFIX, dryRun: true, log: (l) => lines.push(l), ...clock() });
    expect(cluster.deleted).toEqual([]);
    expect(calls).toEqual([]);
    expect(lines).toContain('  将删除 crewstation-system postgres-0');
    expect(lines).toContain('  将重启 cs-demo task-r-ws（development-workspace）');
    expect(lines).toContain('  cs-demo task-cli（development-cli） 随所在的开发会话结束');
    expect(lines).toContain('  将删除 cs-biz task-biz（business-subtask）');
    expect(left).toEqual([]);
  });

  test('旧地址上没有 Pod：什么都不做，也不登录', async () => {
    const cluster = new FakeCluster([{ namespace: 'kube-system', name: 'coredns-new', uid: 'n1', ip: '10.244.130.2', owner: { kind: 'ReplicaSet', name: 'coredns-abc' }, hash: 'abc' }]);
    let logins = 0;
    const left = await rebuildOldRangePods({ kube: cluster.kube(), ops: async () => { logins += 1; throw new Error('不该登录'); }, prefix: PREFIX, log: () => {}, ...clock() });
    expect(left).toEqual([]);
    expect(logins).toBe(0);
    expect(cluster.deleted).toEqual([]);
  });
});

describe('命令行入口', () => {
  test('按参数取前缀、上下文与控制台地址；有留下的 Pod 时逐个列出、退出码 2；--dry-run 只列计划、退出码 0', async () => {
    const seen: string[] = [], out: string[] = [], err: string[] = [];
    const deps = (cluster: FakeCluster, resources: Record<string, TaskResource>) => ({
      kube: (context: string) => { seen.push(`context ${context}`); return cluster.kube(); },
      ops: (consoleUrl: string) => { seen.push(`console ${consoleUrl}`); return async () => fakeOps(cluster, resources).ops; },
      out: (line: string) => out.push(line), err: (line: string) => err.push(line),
    });
    const code = await main(['--prefix', PREFIX, '--context', 'kind-x'], { CS_CONSOLE_URL: 'http://console.example' }, deps(demoCluster(), demoResources));
    expect(code).toBe(2);
    expect(seen).toEqual(['context kind-x', 'console http://console.example']);
    expect(err).toEqual(['还在旧地址上的 Pod：', '    cs-x stray']);
    out.length = 0;
    expect(await main(['--prefix', PREFIX, '--dry-run'], {}, deps(demoCluster(), demoResources))).toBe(0);
    expect(seen.slice(2)).toEqual(['context docker-desktop', 'console http://console.cs.localhost']);
    expect(out.at(-1)).toBe('（只列计划，没有执行）');
  });

  test('旧地址上已经没有 Pod：退出码 0；缺 --prefix 直接报错', async () => {
    const out: string[] = [];
    const empty = { kube: () => new FakeCluster([]).kube(), ops: () => async () => { throw new Error('不该登录'); }, out: (l: string) => out.push(l), err: () => {} };
    expect(await main(['--prefix', PREFIX], {}, empty)).toBe(0);
    expect(out).toEqual(['旧地址上已经没有 Pod']);
    await expect(main([], {}, empty)).rejects.toThrow('缺少 --prefix');
  });
});

describe('kubectl 适配器', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

  /** 打桩的 kubectl 记下参数；列 Pod 给一行 JSON，读副本数给 3，TEST_FAIL 点名的子命令以 stderr 失败。 */
  function stub(): string {
    const dir = mkdtempSync(join(tmpdir(), 'cs-kubectl-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'kubectl'), `#!/bin/bash
printf '%s\\n' "$*" >> "${dir}/calls.log"
case "$*" in
  *'get pods -A -o json'*) echo '{"items":[{"metadata":{"namespace":"a","name":"p","uid":"u"},"status":{"podIP":"10.244.0.5","phase":"Running"}}]}' ;;
  *'delete pod broken'*) echo 'pods "broken" is forbidden' >&2; exit 1 ;;
  *jsonpath*) printf 3 ;;
esac
`);
    chmodSync(join(dir, 'kubectl'), 0o755);
    return dir;
  }

  test('每条命令都带上下文；删 Pod 不等、不存在也不报错；DaemonSet 取期望调度数，其余取 spec.replicas', async () => {
    const dir = stub(), kube = kubectlAdapter('kind-x', join(dir, 'kubectl'));
    expect(parsePods(await kube.pods()).map((p) => p.name)).toEqual(['p']);
    await kube.deletePod('a', 'p');
    expect(await kube.desiredReplicas({ namespace: 'kube-system', kind: 'DaemonSet', name: 'calico-node' })).toBe(3);
    expect(await kube.desiredReplicas({ namespace: 'a', kind: 'Deployment', name: 'web' })).toBe(3);
    expect(readFileSync(join(dir, 'calls.log'), 'utf8').trim().split('\n')).toEqual([
      '--context kind-x get pods -A -o json',
      '--context kind-x -n a delete pod p --wait=false --ignore-not-found',
      '--context kind-x -n kube-system get daemonset calico-node -o jsonpath={.status.desiredNumberScheduled}',
      '--context kind-x -n a get deployment web -o jsonpath={.spec.replicas}',
    ]);
  });

  test('kubectl 失败时带上它的 stderr 抛错', async () => {
    const dir = stub();
    await expect(kubectlAdapter('kind-x', join(dir, 'kubectl')).deletePod('a', 'broken')).rejects.toThrow('pods "broken" is forbidden');
  });
});
