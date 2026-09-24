import { expect, test } from 'bun:test';
import type { ProjectId, ServiceId } from '@crewstation/contracts';
import type { DirectoryService } from '../ports/directories';
import type { LedgerRecordRead } from '../ports/ledger';
import { explainUnavailable, notDeployedBody, notDeployedEntry } from './unavailable';

const since = '2026-09-24T01:00:00.000Z';
const slot = (conditions: LedgerRecordRead['conditions'], display: Record<string, string> = {}): Pick<LedgerRecordRead, 'conditions' | 'display'> => ({ conditions, display });

// RFC-025 D13：说明页照目标槽记录的 Serving 条件写（下线的时间、原因与版本，尚未部署，刚部署好正在切换）。
test('下线的槽：带时间、原因与版本；尚未部署的没有下线记录；Serving 已为真的是正在切换；认不出的原因不编造', () => {
  expect(notDeployedEntry('preview', 'demo', slot([{ type: 'Serving', status: 'false', reason: 'offline-idle', message: '长时间无人访问', since }], { tag: 'v0.1.2' })))
    .toEqual({ kind: 'not-deployed', projectSlug: 'demo', slot: 'preview', offline: { at: since, reason: 'idle', tag: 'v0.1.2' } });
  expect(notDeployedEntry('prod', 'demo', slot([{ type: 'Serving', status: 'false', reason: 'not-deployed', message: '尚未部署', since }]))).toEqual({ kind: 'not-deployed', projectSlug: 'demo', slot: 'prod' });
  expect(notDeployedEntry('preview', 'demo', slot([{ type: 'Serving', status: 'true', since }]))).toEqual({ kind: 'not-deployed', projectSlug: 'demo', slot: 'preview', recovering: true });
  expect(notDeployedEntry('preview', 'demo', slot([{ type: 'Serving', status: 'false', reason: 'offline-unknown', since }]))).toEqual({ kind: 'not-deployed', projectSlug: 'demo', slot: 'preview' });
  expect(notDeployedEntry('preview', 'demo', undefined)).toEqual({ kind: 'not-deployed', projectSlug: 'demo', slot: 'preview' });
});

test('接口的错误体沿用 RFC-021：not-deployed＋details（下线记录）；正式主机与正在切换各有说法', () => {
  expect(notDeployedBody({ kind: 'not-deployed', projectSlug: 'demo', slot: 'preview', offline: { at: since, reason: 'manual', tag: 'v1' } }))
    .toEqual({ error: 'not-deployed', message: 'demo 当前没有待验证版本', details: { at: since, reason: 'manual', tag: 'v1' } });
  expect(notDeployedBody({ kind: 'not-deployed', projectSlug: 'demo', slot: 'prod' })).toEqual({ error: 'not-deployed', message: 'demo 还没有上线的版本', details: {} });
  expect(notDeployedBody({ kind: 'not-deployed', projectSlug: 'demo', slot: 'preview', recovering: true }).message).toBe('demo 刚部署好新版本，正在切换，请稍后重试');
});

const serviceId = '01a0bf5d-8f4b-76c5-866c-f1feda3d63bb' as ServiceId;
const routeId = '01a0d005-cabc-7000-b909-8463b44eda44', slotId = '01a0d005-cabc-7000-b909-8463b44eda45';
const record = (patch: Partial<LedgerRecordRead>): LedgerRecordRead => ({
  id: routeId, kind: 'route', owner: { module: 'gateway', ref: `${serviceId}/preview` }, desired: 'present', phase: 'ready',
  spec: { host: 'preview.demo.cs.localhost', target: { namespace: 'cs-demo', service: 'demo-green', port: 80 } }, display: { role: 'preview' }, conditions: [], ...patch,
});
const demo: DirectoryService = { serviceId, projectId: '01a0bf5d-8f4b-7b10-9a12-5e7d8c4b3a66' as ProjectId, projectSlug: 'demo', serviceName: 'demo', namespace: 'cs-demo', identity: 'demo/demo', kind: 'DigitalWorker', archived: false };

/** slotRecord 为 null：槽记录不在（例如还没有投影）。 */
function explain(route: LedgerRecordRead | undefined, slotRecord: LedgerRecordRead | null = record({ id: slotId, kind: 'service-slot', phase: 'stopped', conditions: [{ type: 'Serving', status: 'false', reason: 'offline-manual', since }], display: { tag: 'v0.1.2' } })) {
  const records = new Map([[routeId, route], [slotId, slotRecord ?? undefined]]);
  return explainUnavailable({
    ledgerReader: { get: async (id) => records.get(id), claimOf: async (child) => (child.kind === 'Service' && child.name === 'demo-green' ? slotId : undefined) },
    services: { listServices: async () => [demo], getService: async (id) => (id === serviceId ? demo : undefined) },
  });
}

test('按路由记录读目标槽：主机对得上才给（不分大小写、去掉端口），给出项目与下线记录', async () => {
  expect(await explain(record({}))(routeId, 'Preview.Demo.cs.localhost:80')).toEqual({ kind: 'not-deployed', projectSlug: 'demo', slot: 'preview', offline: { at: since, reason: 'manual', tag: 'v0.1.2' } });
  expect(await explain(record({}), null)(routeId, 'preview.demo.cs.localhost')).toEqual({ kind: 'not-deployed', projectSlug: 'demo', slot: 'preview' });
});

test('不是冲着这条路由来的一律当不存在：别的主机、不是 ID、不是 gateway 的正式或待验证路由、服务查不到、目标不完整', async () => {
  expect(await explain(record({}))(routeId, 'api.svc.cs.internal')).toBeUndefined();
  expect(await explain(record({}))('demo-preview', 'preview.demo.cs.localhost')).toBeUndefined();
  expect(await explain(undefined)(routeId, 'preview.demo.cs.localhost')).toBeUndefined();
  expect(await explain(record({ kind: 'service-slot' }))(routeId, 'preview.demo.cs.localhost')).toBeUndefined();
  expect(await explain(record({ owner: { module: 'dev-session', ref: 'x' } }))(routeId, 'preview.demo.cs.localhost')).toBeUndefined();
  expect(await explain(record({ display: { role: 'service' } }))(routeId, 'preview.demo.cs.localhost')).toBeUndefined();
  expect(await explain(record({ owner: { module: 'gateway', ref: '01a0bf5d-8f4b-76c5-866c-f1feda3d63bc/preview' } }))(routeId, 'preview.demo.cs.localhost')).toBeUndefined();
  expect(await explain(record({ spec: { host: 'preview.demo.cs.localhost', target: { namespace: 'cs-demo' } } }))(routeId, 'preview.demo.cs.localhost')).toBeUndefined();
  expect(await explain(record({ spec: { target: {} } }))(routeId, undefined)).toBeUndefined();
});
