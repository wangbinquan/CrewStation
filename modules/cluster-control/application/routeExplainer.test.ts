import { expect, test } from 'bun:test';
import type { RouteRender } from '../domain/routeRender';
import type { LedgerObservations, LedgerRecordView } from '../ports/ledger';
import { enqueueRoutesOfSlot, explainerFor, routeTargets, targetKey } from './routeExplainer';

test('目标索引：切流换了目标的路由从旧键上摘下；同一目标重复记不重复', () => {
  const targets = routeTargets();
  targets.note('r-prod', targetKey('cs-demo', 'demo-blue'));
  targets.note('r-prod', targetKey('cs-demo', 'demo-blue'));
  targets.note('r-preview', targetKey('cs-demo', 'demo-blue'));
  expect(targets.routesOf('cs-demo/demo-blue')).toEqual(['r-prod', 'r-preview']);
  targets.note('r-prod', targetKey('cs-demo', 'demo-green'));
  expect(targets.routesOf('cs-demo/demo-blue')).toEqual(['r-preview']);
  expect(targets.routesOf('cs-demo/demo-green')).toEqual(['r-prod']);
  expect(targets.routesOf('cs-demo/none')).toEqual([]);
});

const view = (patch: Partial<LedgerRecordView>): LedgerRecordView => ({ id: 'slot-1', kind: 'service-slot', desired: 'present', phase: 'stopped', spec: { children: [] }, children: [], conditions: [], ...patch }) as LedgerRecordView;

test('槽变了阶段：把指向它 Service 的路由排进队列；别的种类、没有索引时不排', () => {
  const targets = routeTargets(), queued: string[] = [];
  targets.note('r-preview', 'cs-demo/demo-green');
  const slot = view({ spec: { children: [{ kind: 'Deployment', namespace: 'cs-demo', name: 'demo-green' }, { kind: 'Service', namespace: 'cs-demo', name: 'demo-green' }] } });
  enqueueRoutesOfSlot(slot, targets, (id) => queued.push(id));
  enqueueRoutesOfSlot({ ...slot, kind: 'route' }, targets, (id) => queued.push(id));
  enqueueRoutesOfSlot(slot, undefined, (id) => queued.push(id));
  expect(queued).toEqual(['r-preview']);
});

const route: RouteRender = { namespace: 'cs-demo', name: 'demo-preview', service: 'demo', host: 'preview.demo.cs.localhost', target: { namespace: 'cs-demo', service: 'demo-green', port: 80 }, middlewares: [{ name: 'forward-auth-user', namespace: 'crewstation-system' }], unavailable: { middleware: 'unavailable-demo-preview' } };
const explainer = { namespace: 'crewstation-system', service: 'cs-api', port: 8080, path: '/_crewstation/unavailable' };
const ledgerWith = (slot: LedgerRecordView | undefined) => ({ claimOf: async () => (slot ? slot.id : undefined), get: async () => slot }) as unknown as LedgerObservations;

test('只在目标槽「已结束」且期望在时改指说明页：中间件路径带路由记录 ID，接在原链之后，目标换成 cs-api', async () => {
  expect(await explainerFor({ ledger: ledgerWith(view({})), explainer }, view({ id: 'route-1', kind: 'route' }), route)).toEqual({
    middleware: { namespace: 'cs-demo', name: 'unavailable-demo-preview', replacePath: { path: '/_crewstation/unavailable/route-1' } },
    route: { ...route, target: { namespace: 'crewstation-system', service: 'cs-api', port: 8080 }, middlewares: [...route.middlewares, { name: 'unavailable-demo-preview' }] },
  });
  const record = view({ id: 'route-1', kind: 'route' });
  expect(await explainerFor({ ledger: ledgerWith(view({ phase: 'ready' })), explainer }, record, route)).toBeUndefined();
  expect(await explainerFor({ ledger: ledgerWith(view({ desired: 'absent' })), explainer }, record, route)).toBeUndefined();
  expect(await explainerFor({ ledger: ledgerWith(view({ kind: 'dev-workspace' })), explainer }, record, route)).toBeUndefined();
  expect(await explainerFor({ ledger: ledgerWith(undefined), explainer }, record, route)).toBeUndefined();
  expect(await explainerFor({ ledger: ledgerWith(view({})) }, record, route)).toBeUndefined();
  const { unavailable: _unavailable, ...plain } = route;
  expect(await explainerFor({ ledger: ledgerWith(view({})), explainer }, record, plain)).toBeUndefined();
});
