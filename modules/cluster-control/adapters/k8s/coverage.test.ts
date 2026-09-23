import { describe, expect, test } from 'bun:test';
import { namespaceObject } from '@crewstation/k8s';
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
});
