import { describe, expect, test } from 'bun:test';
import { namespaceObject, projectNetworkPolicy, taskEgressNetworkPolicy } from '@crewstation/k8s';
import type { ObservedObject } from '../../domain/observation';
import { covers, objectCovered } from './coverage';
import { routeObject } from './routeObjects';

const route = {
  namespace: 'cs-issues', name: 'issues-internal-api', service: 'issues', host: 'api.svc.cs.internal', pathPrefix: '/api/issues', priority: 100,
  target: { namespace: 'cs-issues', service: 'issues-blue', port: 80 }, middlewares: [{ name: 'strip-api-issues' }],
};

describe('调和器的比对：观测到的对象是不是已经是期望的样子', () => {
  test('期望的字段都在即一致（API Server 补的缺省与多出的标签不算）；缺字段、值不同、数组长度或次序不同都算不一致', () => {
    expect(covers({ a: 1, b: { c: 2, extra: true } }, { b: { c: 2 } })).toBe(true);
    expect(covers({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
    expect(covers({ a: [2, 1] }, { a: [1, 2] })).toBe(false);
    expect(covers({ a: [1, 2, 3] }, { a: [1, 2] })).toBe(false);
    expect(covers({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(covers(undefined, { a: 1 })).toBe(false);
    expect(covers('x', 'x')).toBe(true);
  });

  test('有 spec 的对象：标签与 spec 都覆盖期望才一致', () => {
    const desired = routeObject(route);
    const live: ObservedObject = { kind: 'IngressRoute', metadata: { name: route.name, namespace: route.namespace, uid: 'u1', labels: { ...desired.metadata.labels, extra: 'kept' } }, spec: desired['spec'] };
    expect(objectCovered(live, desired)).toBe(true);
    expect(objectCovered(undefined, desired)).toBe(false);
    expect(objectCovered({ ...live, metadata: { ...live.metadata, labels: {} } }, desired)).toBe(false);
    expect(objectCovered({ ...live, spec: { entryPoints: ['web'], routes: [] } }, desired)).toBe(false);
  });

  test('期望没有 spec 的命名空间只比标签：API Server 补的 finalizers 与名字标签不算不一致，项目标签被改算', () => {
    const desired = namespaceObject('cs-demo', { 'crewstation.io/project': 'demo' });
    const live: ObservedObject = { kind: 'Namespace', metadata: { name: 'cs-demo', uid: 'n1', labels: { ...desired.metadata.labels, 'kubernetes.io/metadata.name': 'cs-demo' } }, spec: { finalizers: ['kubernetes'] } };
    expect(objectCovered(live, desired)).toBe(true);
    expect(objectCovered({ ...live, metadata: { ...live.metadata, labels: { 'app.kubernetes.io/managed-by': 'crewstation', 'crewstation.io/project': 'other' } } }, desired)).toBe(false);
  });

  // 锁住 2026-09-24 实跑发现的两处漏判：网络策略里的空对象有含义（`podSelector: {}` 全选、出向规则 `{}` 全放行），
  // 按子集比会被任何对象当成已覆盖。于是默认策略被改成只选部分 Pod（其余 Pod 失去入向隔离）、全放行的出向被改窄成一条，
  // 调和器都判「未变」、不改回。网络策略的 spec 整个由平台写，要逐字段相同；标签仍只比期望里的那些。
  test('网络策略的 spec 逐字段相同才算一致：选择器或出向被改窄、规则里多了字段都算被改；标签多出来的不算', () => {
    const desired = projectNetworkPolicy({ namespace: 'cs-demo', systemNamespace: 'crewstation-system' });
    const spec = desired['spec'] as Record<string, unknown>;
    const live = (patch: Record<string, unknown>, from: typeof desired = desired): ObservedObject => ({
      kind: 'NetworkPolicy', metadata: { name: from.metadata.name, namespace: 'cs-demo', uid: 'np-1', labels: { ...from.metadata.labels, extra: 'kept' } },
      spec: { ...(from['spec'] as Record<string, unknown>), ...patch },
    });
    const dnsOnly = [{ to: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' } } }], ports: [{ protocol: 'UDP', port: 53 }] }];
    expect(objectCovered(live({}), desired)).toBe(true);
    expect(objectCovered(live({ podSelector: { matchLabels: { tier: 'some' } } }), desired)).toBe(false);
    expect(objectCovered(live({ egress: dnsOnly }), desired)).toBe(false);
    expect(objectCovered(live({ ingress: [{ ...(spec['ingress'] as object[])[0], ports: [{ protocol: 'TCP', port: 80 }] }] }), desired)).toBe(false);
    // 任务容器那几条按标签放行的策略是同一种 `[{}]`，同样要能改回。
    const task = taskEgressNetworkPolicy({ namespace: 'cs-demo' });
    expect(objectCovered(live({}, task), task)).toBe(true);
    expect(objectCovered(live({ egress: dnsOnly }, task), task)).toBe(false);
  });
});
