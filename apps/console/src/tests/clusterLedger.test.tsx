import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import type { ProjectId, ResourceRecord } from '@crewstation/contracts';
import { reclaimableVolumes } from '../features/cluster/components/ClusterReclaimVolumes';
import { dialogConfirmButton, openDialog, typeConfirmWord } from './confirmDialogDriver';
import { renderApp } from './renderApp';
import { clusterFixture } from './clusterManagementFixture';
import { resourceRecord } from './resourceRecordFixture';

// RFC-025 T13（I29 裁定）：集群清单以快照为底，台账认领的行显示所属标准记录的阶段、原因与可做操作；「待回收的工作卷」排在存储之后。
const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; sessionStorage.clear(); });
const since = '2026-09-23T16:48:25.831Z';
const pending = { type: 'PendingReclaim', status: 'true' as const, reason: 'orphaned', message: '集群里有、台账里没有的工作卷：留作待回收，由管理员确认后删除', since };
const volume = (id: string, name: string, patch: Partial<ResourceRecord> = {}) => resourceRecord({
  id, kind: 'volume', owner: { module: 'cluster-control', ref: name }, projectId: '01a0bf5d-8f4b-7e1e-8dde-c9c2ae13ed34' as ProjectId, phase: 'stopped', conditions: [pending], version: 3,
  children: [{ kind: 'PersistentVolumeClaim', namespace: 'cs-cluster-demo', name, phase: 'Bound', ready: true }], actions: [{ id: 'delete-volume', enabled: true }], ...patch,
});

test('only pending volumes whose claim still exists are listed', () => {
  const kept = volume('01a0cf2b-22e3-7000-a175-bb5d15360001', 'orphan-work');
  const deleted = volume('01a0cf2b-22e3-7000-a175-bb5d15360002', 'gone-work', { children: [{ kind: 'PersistentVolumeClaim', namespace: 'cs-cluster-demo', name: 'gone-work', phase: 'absent', ready: false }] });
  const live = volume('01a0cf2b-22e3-7000-a175-bb5d15360003', 'live-work', { conditions: [], phase: 'ready' });
  expect(reclaimableVolumes([kept, deleted, live, resourceRecord({ id: '01a0cf2b-22e3-7000-a175-bb5d15360004' })]).map((r) => r.id)).toEqual([kept.id]);
});

test('「待回收的工作卷」列出待回收的卷，筛选条不出现；删除要输入 delete，受理后按钮写明正在回收', async () => {
  const f = clusterFixture();
  f.records.push(volume('01a0cf2b-22e3-7000-a175-bb5d15360011', 'orphan-work'), volume('01a0cf2b-22e3-7000-a175-bb5d15360012', 'retained-work', { actions: [{ id: 'delete-volume', enabled: false, disabledReason: '已受理删除，正在回收' }] }));
  page = await renderApp('/admin/cluster?tab=reclaim');
  expect(document.querySelector('[role="group"][aria-label="资源清单"] button[aria-pressed="true"]')?.textContent).toBe('待回收的工作卷');
  expect(page.text()).not.toContain('筛选清单');
  expect(page.text()).toContain('待回收的工作卷 · 2'); expect(page.text()).toContain('集群验收'); expect(page.text()).toContain('集群里有、台账里没有的工作卷');
  const view = f.calls.find((c) => c.path === '/v1/admin/resources')!;
  expect(Object.fromEntries(view.query)).toEqual({ kind: 'volume', includeStopped: 'true' });
  const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('[data-reclaim-volume] button')];
  expect(buttons().map((b) => b.disabled)).toEqual([false, true]); expect(page.text()).toContain('已受理删除，正在回收');
  await act(async () => { buttons()[0]!.click(); }); await page.settle();
  expect(openDialog().textContent).toContain('删除项目「集群验收」的工作卷“orphan-work”？'); expect(openDialog().textContent).toContain('无法恢复');
  expect(dialogConfirmButton().disabled).toBe(true); await typeConfirmWord('delete');
  await act(async () => { dialogConfirmButton().click(); }); await page.settle();
  const write = f.calls.find((c) => c.method === 'POST' && c.path.startsWith('/v1/resources/'))!;
  expect(write.path).toBe('/v1/resources/01a0cf2b-22e3-7000-a175-bb5d15360011/actions/delete-volume'); expect(write.body).toEqual({ expectedVersion: 3 });
  expect(document.querySelectorAll('dialog[open]').length).toBe(0);
  expect(buttons().map((b) => b.disabled)).toEqual([true, true]);
});

test('台账认领的行显示标准阶段与原因，集群观测退为小字；详情里给记录的操作，不可撤销的要确认词', async () => {
  const f = clusterFixture();
  f.row.ledger = { id: '01a0cf2b-22e3-7000-a175-bb5d15360021', kind: 'service-slot', phase: 'degraded', phaseSince: since, reason: { code: 'crash-looping', message: '容器反复重启' }, actions: [{ id: 'release', enabled: true }, { id: 'retry', enabled: false, disabledReason: '只有失败的才可以重试' }], version: 7, maintained: false };
  page = await renderApp('/admin/cluster?tab=workloads');
  for (const part of ['降级', '集群观测：Active', '容器反复重启']) expect(page.text()).toContain(part);
  await page.click('cluster-demo-green');
  const panel = document.querySelector('[data-ledger-record]')!;
  for (const part of ['资源中心记录', '服务槽', '降级', '容器反复重启', '只有失败的才可以重试']) expect(panel.textContent).toContain(part);
  await act(async () => { [...panel.querySelectorAll('button')].find((b) => b.textContent === '释放')!.click(); }); await page.settle();
  expect(openDialog().textContent).toContain('确认释放“cluster-demo-green”？');
  await typeConfirmWord('delete'); await act(async () => { dialogConfirmButton().click(); }); await page.settle();
  const write = f.calls.find((c) => c.method === 'POST' && c.path.startsWith('/v1/resources/'))!;
  expect(write.path).toBe('/v1/resources/01a0cf2b-22e3-7000-a175-bb5d15360021/actions/release'); expect(write.body).toEqual({ expectedVersion: 7 });
  // 做完详情重读，阶段随记录更新。
  expect(f.calls.filter((c) => c.path.endsWith('/resource-uid')).length).toBeGreaterThanOrEqual(2);
});
