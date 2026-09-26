import { expect, test } from 'bun:test';
import type { LedgerRecordView } from '../ports/ledger';
import type { ReconcileDeps } from './reconcileObservations';
import { routeMatchKey, winningRoute } from './routeArbitration';

const route = (id: string, host = 'api.svc.cs.internal', pathPrefix?: string): LedgerRecordView => ({ id, kind: 'route', desired: 'present', generation: 1, phase: 'ready', children: [], conditions: [], parentId: `parent-${id}`, spec: { children: [{ kind: 'IngressRoute', namespace: 'cs-demo', name: id }], host, ...(pathPrefix ? { pathPrefix } : {}), service: 'demo', target: { namespace: 'cs-demo', service: id, port: 80 }, middlewares: [] } });

test('入口键只规范化 Host，保留路径大小写、尾斜杠及不同 API 前缀', () => {
  expect(routeMatchKey('API.SVC.CS.INTERNAL.', '/api/a')).toBe(routeMatchKey('api.svc.cs.internal', '/api/a'));
  for (const path of ['/api/b', '/api/a/', '/API/a', undefined]) expect(routeMatchKey('api.svc.cs.internal', path)).not.toBe(routeMatchKey('api.svc.cs.internal', '/api/a'));
});

test('同入口只择一：上级 ready 优于 starting，其余按稳定 ID；释放后候补接替', async () => {
  const a = route('a'), b = route('b'), c = route('c');
  const parents = new Map([['parent-a', { ...a, phase: 'stopped' }], ['parent-b', { ...b, phase: 'starting' }], ['parent-c', { ...c, phase: 'ready' }]]);
  const get = async (id: string) => parents.get(id);
  expect((await winningRoute([b, a, c], get))?.id).toBe('c');
  expect((await winningRoute([b, a, { ...c, desired: 'absent' }], get))?.id).toBe('b');
  expect((await winningRoute([c, b, a], async () => undefined))?.id).toBe('a');
  expect(await winningRoute([], get)).toBeUndefined();
});

// 真实 API Server 列表已看见旧入口而 watch 仍没到：必须先按 UID 删除，下一轮确认消失才让新入口应用。
test('仲裁等待旧路由消失，释放项与无效期望不参选；查询截断、丢失租约时不写集群', async () => {
  const { arbitrateRoute } = await import('./routeArbitration');
  const { newObservationStats } = await import('./observeChange');
  const { routeTargets } = await import('./routeExplainer');
  const a = route('a'), b = route('b'), unrelated = route('other', 'api.svc.cs.internal', '/api/other');
  let candidates = [a, b, unrelated, { ...route('broken'), spec: { children: [] } }];
  let live = [{ kind: 'IngressRoute', metadata: { namespace: 'cs-demo', name: 'b', uid: 'old-b' } }];
  const removed: unknown[] = [], conditions: unknown[] = [], queued: unknown[] = [];
  const targets = routeTargets();
  const deps = {
    ledger: { routeCandidates: async () => candidates, get: async () => undefined, observeConditions: async (id: string, next: unknown) => { conditions.push([id, next]); }, claimOf: async () => undefined },
    reader: { list: async () => live }, cluster: { remove: async (value: unknown) => { removed.push(value); } },
    stats: newObservationStats(), systemNamespace: 'crewstation-system', routeTargets: targets,
  } as unknown as ReconcileDeps;
  const enqueue = (id: string, after?: number) => { queued.push([id, after]); };
  expect(await arbitrateRoute(deps, a, enqueue)).toBe(false);
  expect(removed).toEqual([{ kind: 'IngressRoute', namespace: 'cs-demo', name: 'b', uid: 'old-b' }]);
  expect(queued).toContainEqual(['a', 2000]);
  expect(targets.childrenOf('parent-b')).toEqual(['b']);
  live = [];
  expect(await arbitrateRoute(deps, a, enqueue)).toBe(true);
  expect(await arbitrateRoute(deps, b, enqueue)).toBe(false);
  expect(queued).toContainEqual(['a', undefined]);
  expect(conditions).toContainEqual(['b', [{ type: 'Superseded', status: 'true', reason: 'route-superseded', message: '同一入口由资源 a 提供，当前路由已停用' }]]);
  candidates = [{ ...a, desired: 'absent' }, { ...b, desired: 'absent' }];
  expect(await arbitrateRoute(deps, candidates[0]!, enqueue)).toBe(false);
  expect(await arbitrateRoute(deps, { ...a, spec: { children: [] } }, enqueue)).toBe(false);
  candidates = Array.from({ length: 2000 }, () => a);
  await expect(arbitrateRoute(deps, a, enqueue)).rejects.toThrow('查询上限');
  candidates = [a, b];
  await expect(arbitrateRoute({ ...deps, signal: AbortSignal.abort() }, a, enqueue)).rejects.toBeDefined();
  expect(removed).toHaveLength(1);
});
