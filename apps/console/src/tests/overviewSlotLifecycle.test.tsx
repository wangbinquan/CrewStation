import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import type { ReleaseId } from '@crewstation/contracts';
import { renderApp } from './renderApp';
import { summaryFixture } from './projectSummaryFixture';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

const prodRelease = '01a0bf5d-8f4b-7c41-8000-000000000001' as ReleaseId, previewRelease = '01a0bf5d-8f4b-7c41-8000-000000000002' as ReleaseId;
const slot = (name: 'prod' | 'preview', tag: string, releaseId: ReleaseId) => ({ name, active: name === 'prod', tag, commitSha: (name === 'prod' ? 'a' : 'b').repeat(40), releaseId, host: `${name}.test`, state: 'ready' as const, replicas: 1, readyReplicas: 1 });
const card = (title: string) => [...document.querySelectorAll('section')].find((node) => node.querySelector('h2')?.textContent === title)?.textContent ?? '';

/** 概览与发布页同一张版本卡：维护状态从服务的维护接口读，其余来自项目摘要。 */
function withMaintenance(current: unknown) {
  const base = globalThis.fetch;
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://test').pathname;
    if (path.endsWith('/maintenance')) return Response.json({ current, history: [] });
    return base(raw, init);
  }) as typeof fetch;
}

// RFC-021 M13、B2、B6：概览的正式版本卡显示维护角标与原因，待验证卡写明何时自动下线；已下线时写明何时因何下线。
test('概览：正式版本维护中有角标与原因，待验证卡写明自动下线时间；已下线写明原因', async () => {
  const f = summaryFixture(), time = new Date().toISOString();
  f.item.slots = { status: 'ready', checkedAt: time, value: [slot('prod', 'v1.0.0', prodRelease), { ...slot('preview', 'v1.0.1', previewRelease), retention: { kind: 'pending', since: time, deadline: '2026-10-07T00:00:00.000Z', postponable: false, postponements: 0, periodHours: 336 } }] };
  withMaintenance({ serviceId: f.item.project.serviceId, projectId: f.item.project.id, switches: { users: true, services: true, events: false }, allowUsers: [], reason: '换库', startedBy: f.item.project.ownerUserId, startedAt: time, updatedBy: f.item.project.ownerUserId, updatedAt: time, revision: 1 });
  page = await renderApp(`/projects/${f.item.project.id}`);
  expect(card('正式版本')).toContain('维护中'); expect(card('正式版本')).toContain('维护中：换库');
  expect(card('待验证版本')).toContain('前仍无人访问将自动下线'); expect(card('待验证版本')).not.toContain('维护中');
  f.item.slots.value[1] = { name: 'preview', active: false, state: 'empty', replicas: 0, readyReplicas: 0, host: 'preview.test', offline: { releaseId: previewRelease, tag: 'v1.0.1', at: time, reason: 'idle' } } as never;
  await page.reread();
  expect(card('待验证版本')).toContain('已下线'); expect(card('待验证版本')).toContain('v1.0.1 已于'); expect(card('待验证版本')).toContain('长期无人访问，平台自动下线');
  expect(document.querySelector('a[href="//preview.test"]')).toBeNull();
});

test('概览：维护读不到或不在维护时不画角标，不猜', async () => {
  const f = summaryFixture(), time = new Date().toISOString();
  f.item.slots = { status: 'ready', checkedAt: time, value: [slot('prod', 'v1.0.0', prodRelease), slot('preview', 'v1.0.1', previewRelease)] };
  withMaintenance(null);
  page = await renderApp(`/projects/${f.item.project.id}`);
  expect(card('正式版本')).not.toContain('维护中');
});
