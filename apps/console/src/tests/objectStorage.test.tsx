import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import type { ArchiveArtifactDeletion, ArchiveRevisionPreview, BusinessStorageLossAssessment, ObjectBackendDto, ObjectSpaceDto, ObjectStorageObservation, ObjectStoragePlanDto, StoredObjectDto } from '@crewstation/contracts';
import { BusinessTaskStorageDetailSchema, ObjectStorageObservationSchema, ProjectIdSchema, ServiceIdSchema, UserIdSchema } from '@crewstation/contracts';
import { renderApp } from './renderApp';
import { clusterFixture } from './clusterManagementFixture';
import { storageBytes } from '../features/object-storage/model/storageValues';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; sessionStorage.clear(); });
function storageFixture() {
  const base = clusterFixture(), fallback = globalThis.fetch, id = Bun.randomUUIDv7(), time = new Date().toISOString();
  const backend: ObjectBackendDto = { id, name: 'Local Garage', endpoint: 'http://garage:3900', region: 'garage', bucket: 'crewstation-objects', revision: 1, placementRevision: 1, credentialRevision: 1, state: 'active', health: 'ready', durability: 'dev-only', durabilityVerifiedAt: null, budgetBytes: 60 * 1024 ** 3, reservedBytes: 1000, physicalFreeBytes: null, physicalTotalBytes: null, observedAt: time, message: null, createdAt: time };
  const spaces: ObjectSpaceDto[] = Array.from({ length: 55 }, (_, i) => ({ id: Bun.randomUUIDv7(), projectId: ProjectIdSchema.parse(base.projectId), serviceId: ServiceIdSchema.parse('01a0bf5d-8f4b-7a02-8000-000000000001'), serviceSlug: `service-${i + 1}`, env: 'production', backendId: id, backendPlacementRevision: 1, planId: Bun.randomUUIDv7(), planRevision: 1, revision: 1, health: 'ready', quotaBytes: 2000, usedBytes: 300, reservedBytes: 100, deletingBytes: 20, objectCount: 1, createdAt: time }));
  const object: StoredObjectDto = { id: Bun.randomUUIDv7(), spaceId: spaces.at(-1)!.id, revision: 1, name: 'report.txt', size: 300, sha256: 'a'.repeat(64), mediaType: 'text/plain', state: 'ready', referenceCount: 1, createdAt: time, verifiedAt: time, message: null };
  const plans: ObjectStoragePlanDto[] = [{ id: spaces[0]!.planId, name: 'Standard storage', backendId: id, revision: 2, quotaBytes: 20 * 1024 ** 3, maxObjectBytes: 1024 ** 3, maxConcurrentTransfers: 4, enabled: true }];
  const behavior = { failWrites: false }, policy = { projectId: base.projectId, revision: 7, planIds: [plans[0]!.id] };
  let artifactsDeleted: ArchiveArtifactDeletion | null = null;
  const observation: ObjectStorageObservation = ObjectStorageObservationSchema.parse({ backendId: id, spaceId: null, health: 'ready', window: '1h', observedAt: time, stale: false, unavailableReason: null,
    logical: { usedBytes: 300, reservedBytes: 100, deletingBytes: 20, quotaBytes: 2000 }, physical: { freeBytes: null, totalBytes: null, observedAt: null }, queue: { uploading: 1, verifying: 2, deleting: 1, failed: 1, unknownWrites: 1, activeDownloads: 1, unknownDownloads: 0, pendingBytes: 400, oldestPendingAt: time },
    samples: [{ at: time, readBytesPerSecond: null, writeBytesPerSecond: 0, requestsPerSecond: 0, errorRatio: null, p95Seconds: null }], blockers: [{ taskId: Bun.randomUUIDv7(), operationId: Bun.randomUUIDv7(), phase: 'archiving', code: 'quota', message: '归档容量不足，工作卷保留', since: time }], blockersNextCursor: null, lastBackupAt: null });
  const blocker = observation.blockers[0]!;
  const task = BusinessTaskStorageDetailSchema.parse({ taskId: blocker.taskId, projectId: base.projectId, serviceId: spaces[0]!.serviceId, completionPolicy: 'archive-and-delete',
    finalization: { operationId: blocker.operationId, taskId: blocker.taskId, revision: 1, taskGeneration: 2, outcome: 'succeeded', phase: 'cleaning', phaseState: 'blocked', errorCode: 'reclaim_pending', message: '等待底层空间回收证明', retryable: false, nextRetryAt: null,
      computeStopped: true, artifactsReady: true, volumeDisposition: 'unknown', storageReclaimed: null, createdAt: time, updatedAt: time,
      receipt: { id: Bun.randomUUIDv7(), taskId: blocker.taskId, finalizationId: blocker.operationId, taskGeneration: 2, finalizationRevision: 1, volumeUid: Bun.randomUUIDv7(), manifestDigest: 'b'.repeat(64), disposition: 'archived', itemCount: 1, noArtifactsReason: null, lossActorId: null, lossReason: null, createdAt: time } } });
  const historyCursor = Bun.randomUUIDv7(), history = { operationId: blocker.operationId, taskId: blocker.taskId, revision: 1, state: 'receipted', receiptId: task.finalization!.receipt!.id, createdAt: time, updatedAt: time };
  const finalization = task.finalization!, volumeUid = finalization.receipt!.volumeUid;
  const loss: BusinessStorageLossAssessment = { operationId: finalization.operationId, revision: 1, volumeUid, assessmentDigest: 'e'.repeat(64),
    items: [{ item: { state: 'lost', name: 'missing-report', reason: '未取得已验证文件' }, path: 'report.txt', sourceObjectId: null, referenceCount: null }],
    itemCount: 1, savedCount: 0, lostCount: 1, nextOffset: null, resultsIncomplete: true, executionStopConfirmed: false };
  const revisionPreview: ArchiveRevisionPreview = { operationId: finalization.operationId, revision: 1, taskGeneration: 2, volumeUid, oldCount: 101, newCount: 0, discardedCount: 101,
    discarded: Array.from({ length: 100 }, (_, i) => ({ kind: 'file', path: `report-${i}.txt`, name: `report-${i}`, required: true })), nextOffset: 100 };
  const taskRows = Array.from({ length: 30 }, (_, i) => ({ id: i === 29 ? task.taskId : Bun.randomUUIDv7(), protocol: 'v3', projectId: base.projectId, labels: { name: `业务报告 ${i + 1}` }, state: 'paused', updatedAt: time }));
  const calls: { url: URL; method: string; body?: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (raw, init) => {
    const url = new URL(String(raw), 'http://localhost'), method = init?.method ?? 'GET';
    if (url.pathname === '/v1/projects') return Response.json({ items: [{ id: base.projectId, name: '集群验收', kind: 'DigitalWorker' }] });
    if (!url.pathname.startsWith('/v3/')) return fallback(raw, init);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    calls.push({ url, method, body });
    if (url.pathname.endsWith('/archive-revision-preview')) return Response.json(body?.offset ? { ...revisionPreview, discarded: [{ kind: 'file', path: 'report-100.txt', name: 'report-100', required: true }], nextOffset: null } : revisionPreview);
    if (method !== 'GET') {
      if (behavior.failWrites) return Response.json({ error: 'conflict', message: '配置修订已变化，请核对后重试' }, { status: 409 });
      if (url.pathname.endsWith('/delete-artifacts')) { artifactsDeleted = { receiptId: String(body!.expectedReceiptId), reason: String(body!.reason), actorId: UserIdSchema.parse(Bun.randomUUIDv7()), deletedAt: time, objectCount: 1, retainedObjectCount: 1 }; return Response.json(artifactsDeleted, { status: 202 }); }
      if (url.pathname.endsWith('/rotate-credential')) { Object.assign(backend, { revision: backend.revision + 1, credentialRevision: backend.credentialRevision + 1 }); return Response.json(backend); }
      if (url.pathname.endsWith('/confirm-loss')) return Response.json({ ...finalization.receipt, disposition: 'loss', lossActorId: Bun.randomUUIDv7(), lossReason: body!.reason }, { status: 202 });
      if (url.pathname.endsWith('/revise-archive')) { task.finalization = { ...task.finalization!, revision: 2, phase: 'requested', phaseState: 'pending' }; return Response.json(task.finalization, { status: 202 }); }
      if (url.pathname.endsWith('/finalize')) { task.finalization = { ...finalization, phase: 'requested', phaseState: 'pending', errorCode: null, message: null, computeStopped: false, artifactsReady: false, receipt: null }; return Response.json(task.finalization, { status: 202 }); }
      if (url.pathname.endsWith('/archive-plans')) return Response.json({ id: Bun.randomUUIDv7(), revision: 1, state: 'sealed', digest: 'c'.repeat(64) }, { status: 201 });
      if (url.pathname.endsWith('/project-plans')) { Object.assign(policy, { planIds: body!.planIds, revision: 8 }); return Response.json(policy); }
      if (url.pathname.includes('/plans')) return Response.json({ ...plans[0], ...(body?.plan as object ?? body), revision: 3 });
      if (url.pathname.endsWith(`/backends/${id}`)) { Object.assign(backend, body, { revision: backend.revision + 1 }); return Response.json(backend); }
      return Response.json(backend);
    }
    if (url.pathname.endsWith('/backends')) return Response.json({ items: [backend] });
    if (url.pathname.endsWith('/object-storage/tasks')) return Response.json({ items: taskRows });
    if (url.pathname.endsWith('/finalization-preview')) return Response.json({ task: { id: task.taskId, generation: 2, volumeUid }, projectId: base.projectId, finalization: task.finalization, activeExecutions: 2, unknownExecutions: 1 });
    if (url.pathname.endsWith('/loss-assessment')) return Response.json(loss);
    if (url.pathname.endsWith(`/tasks/${task.taskId}`)) return Response.json(task);
    if (url.pathname.endsWith('/finalizations')) return Response.json({ items: [url.searchParams.has('cursor') ? history : { ...history, operationId: historyCursor, taskId: Bun.randomUUIDv7() }], nextCursor: url.searchParams.has('cursor') ? null : historyCursor });
    if (url.pathname.endsWith('/receipt-items')) return Response.json({ receipt: task.finalization!.receipt, artifactsDeleted, items: [{ state: 'saved', name: object.name, objectId: object.id, size: object.size, sha256: object.sha256 }], nextOffset: null });
    if (url.pathname.endsWith('/plans')) return Response.json({ items: plans });
    if (url.pathname.endsWith('/policy')) return Response.json(policy);
    if (url.pathname.endsWith('/spaces')) return Response.json({ items: spaces });
    if (url.pathname.endsWith('/observation')) return Response.json({ ...observation, window: url.searchParams.get('window') });
    if (url.pathname.endsWith('/blockers')) return Response.json({ items: [{ ...observation.blockers[0], operationId: Bun.randomUUIDv7(), message: '第二页：等待底层存储释放' }], nextCursor: null });
    if (url.pathname.endsWith('/objects')) return Response.json({ items: [object], nextCursor: url.searchParams.get('cursor') ? null : object.id });
    if (url.pathname.endsWith(`/objects/${object.id}`)) return Response.json(object);
    return Response.json({ error: 'not_found', message: 'unknown' }, { status: 404 });
  }) as typeof fetch;
  return { ...base, backend, spaces, object, observation, task, plans, policy, behavior, calls, loss, revisionPreview };
}
test('long-list storage details use the shared dialog and preserve list, scroll and opener focus', async () => {
  const f = storageFixture(); page = await renderApp('/admin/object-storage');
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent === '查看观测'), opener = buttons.at(-1)!;
  const table = opener.closest('table')!, scroll = document.querySelector<HTMLElement>('main')!; scroll.scrollTop = 350;
  await act(async () => { opener.focus(); opener.click(); }); await page.settle();
  const dialog = document.querySelector<HTMLDialogElement>('dialog[data-cs-dialog]')!;
  expect(dialog?.open).toBe(true); expect(dialog.textContent).toContain('service-55');
  expect(dialog.textContent).toContain('归档容量不足，工作卷保留'); expect(dialog.textContent).toContain('尚无备份记录');
  expect(dialog.querySelectorAll('svg[role="img"]')).toHaveLength(5);
  expect(dialog.textContent).toContain('0 B/s'); expect(dialog.textContent).toContain('—');
  expect(dialog.closest('table')).toBeNull();
  await act(async () => dialog.dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true }))); await page.settle();
  expect(document.querySelector('dialog')).toBeNull(); expect(document.activeElement).toBe(opener); expect(opener.closest('table')).toBe(table); expect(scroll.scrollTop).toBe(350);
  expect(f.calls.every((c) => c.method === 'GET')).toBe(true);
});
test('unknown metrics remain unknown; window changes query the right scope and failures stay visible', async () => {
  const f = storageFixture(); page = await renderApp('/admin/object-storage'); await page.click('查看观测');
  const select = document.querySelector<HTMLSelectElement>('dialog select')!;
  f.observation.stale = true; f.observation.unavailableReason = 'prometheus temporarily unavailable'; f.observation.samples = [];
  await act(async () => { select.value = '7d'; select.dispatchEvent(new Event('change', { bubbles: true })); }); await page.settle();
  expect(f.calls.at(-1)?.url.pathname).toContain(`/backends/${f.backend.id}/observation`); expect(f.calls.at(-1)?.url.searchParams.get('window')).toBe('7d');
  expect(page.text()).toContain('指标缺失或已过期'); expect(page.text()).toContain('没有可用的传输样本');
  expect(document.querySelector('dialog svg')).toBeNull(); expect(storageBytes(null)).toBe('—'); expect(storageBytes(0)).toBe('0 B');
});
test('backup observations retain prior success, show failure and unknown restore state, and never launch operational work', async () => {
  const f = storageFixture(), time = new Date().toISOString();
  f.observation.backup = { lastSucceededAt: '2026-09-01T00:00:00.000Z', lastRestoreVerifiedAt: null, latest: {
    id: Bun.randomUUIDv7(), destination: 'Independent backup site', reason: 'before upgrade', state: 'failed', startedAt: time, updatedAt: time, completedAt: time,
    objectCount: 12, bytes: 4096, manifestDigest: null, errorCode: 'export_failed',
  } };
  f.observation.lastBackupAt = f.observation.backup.lastSucceededAt;
  page = await renderApp('/admin/object-storage'); await page.click('查看观测');
  expect(page.text()).toContain('本次备份失败'); expect(page.text()).toContain('Independent backup site');
  expect(page.text()).toContain('未更新成功备份时间'); expect(page.text()).toContain('尚无验证记录'); expect(page.text()).toContain('已校验对象数');
  expect(page.text()).not.toContain('备份已校验完成'); expect(f.calls.every((c) => c.method === 'GET')).toBe(true);
});
test('object details are nested dialogs and Esc keeps the parent page and cursor', async () => {
  const f = storageFixture(); page = await renderApp('/admin/object-storage');
  const opener = [...document.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent === '查看观测').at(-1)!;
  await act(async () => opener.click()); await page.settle();
  await act(async () => [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === '已发布对象')!.click()); await page.settle();
  await page.click('下一页'); const cursor = f.calls.at(-1)?.url.searchParams.get('cursor'); expect(cursor).toBe(f.object.id);
  await page.click('查看详情'); expect(document.querySelectorAll('dialog')).toHaveLength(2);
  const details = [...document.querySelectorAll('dialog')].at(-1)!; expect(details.textContent).toContain('a'.repeat(64));
  expect(details.querySelector('a[download]')?.getAttribute('href')).toBe(`/v3/object-storage/objects/${f.object.id}/content`);
  expect(f.calls.some((c) => c.url.pathname.endsWith('/content'))).toBe(false);
  await act(async () => details.dispatchEvent(new Event('cancel', { cancelable: true }))); await page.settle();
  expect(document.querySelectorAll('dialog')).toHaveLength(1); expect(page.text()).toContain('report.txt');
  expect(f.calls.filter((c) => c.url.pathname.endsWith('/objects')).at(-1)?.url.searchParams.get('cursor')).toBe(cursor);
});
test('project storage only reads project-scoped spaces and never requests the admin backend list', async () => {
  const f = storageFixture(); page = await renderApp(`/projects/${f.projectId}/object-storage`);
  expect(page.text()).toContain('service-55'); expect(new Set(f.calls.map((c) => c.url.pathname))).toEqual(new Set([`/v3/projects/${f.projectId}/object-storage/spaces`, `/v3/projects/${f.projectId}/object-storage/tasks`]));
});

test('blockers page through the current scope; nested details preserve the cursor and do not run cleanup', async () => {
  const f = storageFixture(); f.observation.blockersNextCursor = f.observation.blockers[0]!.operationId;
  page = await renderApp('/admin/object-storage'); await page.click('查看观测'); await page.click('下一页');
  const request = f.calls.at(-1)!; expect(request.url.pathname).toBe(`/v3/admin/object-storage/backends/${f.backend.id}/blockers`);
  expect(request.url.searchParams.get('cursor')).toBe(f.observation.blockersNextCursor);
  expect(page.text()).toContain('第二页：等待底层存储释放'); await page.click('查看阻塞详情');
  expect(document.querySelectorAll('dialog')).toHaveLength(2);
  const details = [...document.querySelectorAll('dialog')].at(-1)!;
  expect(details.textContent).toContain('终结操作 ID'); expect(details.textContent).toContain('不会跳过归档');
  expect(details.textContent).toContain('归档收据'); expect(details.textContent).toContain('处置结果未知');
  const facts = [...details.querySelectorAll('dl > div')];
  expect(facts.find((row) => row.querySelector('dt')?.textContent === '归档产物就绪')?.querySelector('dd')?.textContent).toBe('已确认');
  expect(facts.find((row) => row.querySelector('dt')?.textContent === '底层空间已释放')?.querySelector('dd')?.textContent).toBe('未知');
  expect(details.textContent).toContain('收据文件清单');
  expect(details.querySelector('a[download]')?.getAttribute('href')).toBe(`/v3/object-storage/objects/${f.object.id}/content`);
  expect(details.querySelector(`a[href="/projects/${f.projectId}/operations?tab=topology"]`)).not.toBeNull();
  await act(async () => details.dispatchEvent(new Event('cancel', { cancelable: true }))); await page.settle();
  expect(document.querySelectorAll('dialog')).toHaveLength(1); expect(page.text()).toContain('第二页：等待底层存储释放');
  await page.click('上一页'); expect(page.text()).toContain('归档容量不足，工作卷保留');
  expect(f.calls.every((c) => c.method === 'GET')).toBe(true);
});
test('receipts stay reachable from archive history without any blocker; details preserve the selected page and opener focus', async () => {
  const f = storageFixture(); f.observation.blockers = [];
  page = await renderApp('/admin/object-storage'); await page.click('查看观测');
  await act(async () => [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === '归档与回收记录')!.click()); await page.settle();
  await page.click('下一页');
  const cursor = f.calls.filter((c) => c.url.pathname.endsWith('/finalizations')).at(-1)!.url.searchParams.get('cursor'); expect(cursor).not.toBeNull();
  const opener = [...document.querySelectorAll<HTMLButtonElement>('dialog button')].find((b) => b.textContent === '查看归档与回收')!;
  await act(async () => { opener.focus(); opener.click(); }); await page.settle();
  const details = [...document.querySelectorAll('dialog')].at(-1)!;
  expect(document.querySelectorAll('dialog')).toHaveLength(2); expect(details.textContent).toContain('收据文件清单');
  expect(details.querySelector('a[download]')).not.toBeNull();
  await act(async () => details.dispatchEvent(new Event('cancel', { cancelable: true }))); await page.settle();
  expect(document.querySelectorAll('dialog')).toHaveLength(1); expect(document.activeElement).toBe(opener);
  expect(f.calls.filter((c) => c.url.pathname.endsWith('/finalizations')).at(-1)!.url.searchParams.get('cursor')).toBe(cursor);
  expect(f.calls.every((c) => c.method === 'GET')).toBe(true);
});

async function field(label: string, value: string) {
  const current = [...document.querySelectorAll('dialog')].at(-1)!;
  const el = [...current.querySelectorAll('label')].find((node) => node.querySelector('span')?.textContent === label)?.querySelector('input,select,textarea') as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | undefined;
  if (!el) throw new Error(`missing field ${label}`);
  await act(async () => {
    el.focus();
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    if (!(el instanceof HTMLSelectElement)) el.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
  }); await page!.settle();
}
test('backend registration keeps a cancelled draft and same retry key; credentials are not read back', async () => {
  const f = storageFixture(); page = await renderApp('/admin/object-storage'); await page.click('登记后端');
  await field('名称', 'new backend'); await field('S3 地址', 'http://garage:3900'); await field('私有桶', 'private-bucket'); await field('Access Key', 'private-key'); await field('Secret Key', 'private-secret');
  await page.click('取消'); expect(f.calls.every((c) => c.method === 'GET')).toBe(true);
  await page.click('登记后端'); expect((document.querySelector('dialog input') as HTMLInputElement).value).toBe('new backend');
  f.behavior.failWrites = true; await page.click('保存'); expect(page.text()).toContain('配置修订已变化');
  const first = f.calls.filter((c) => c.method === 'POST').at(-1)!; expect(first.body).toMatchObject({ name: 'new backend', secretAccessKey: 'private-secret', budgetBytes: 60 * 1024 ** 3 });
  f.behavior.failWrites = false; await page.click('保存');
  expect(f.calls.filter((c) => c.method === 'POST').at(-1)?.body?.requestKey).toBe(first.body?.requestKey);
  expect(document.querySelectorAll('dialog')).toHaveLength(0); expect(page.text()).not.toContain('private-secret');
  await page.click('登记后端'); expect((document.querySelector('dialog input') as HTMLInputElement).value).toBe('');
});
test('availability changes require a nested confirmation and send the opening revision only after confirmation', async () => {
  const f = storageFixture(); page = await renderApp('/admin/object-storage'); await page.click('编辑后端');
  await field('状态', 'offline'); await page.click('保存'); expect(document.querySelectorAll('dialog')).toHaveLength(2);
  expect(f.calls.every((c) => c.method === 'GET')).toBe(true); expect(page.text()).toContain('离线会阻断传输与清理');
  const confirmation = [...document.querySelectorAll('dialog')].at(-1)!;
  await act(async () => confirmation.dispatchEvent(new Event('cancel', { cancelable: true }))); await page.settle();
  expect(document.querySelectorAll('dialog')).toHaveLength(1); await page.click('保存'); await page.click('保存');
  expect(f.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ expectedRevision: 1, state: 'offline' });
  expect(document.querySelectorAll('dialog')).toHaveLength(0);
});
test('plans validate units before sending and save the fixed backend and revision; project access uses the loaded policy revision', async () => {
  const f = storageFixture(); page = await renderApp('/admin/object-storage'); await page.click('编辑档位');
  await field('单对象上限（MiB）', '2048'); await page.click('保存'); expect(page.text()).toContain('单对象最大 1024 MiB'); expect(f.calls.every((c) => c.method === 'GET')).toBe(true);
  await field('单对象上限（MiB）', '512'); await page.click('保存');
  expect(f.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ expectedRevision: 2, plan: { backendId: f.backend.id, maxObjectBytes: 512 * 1024 ** 2 } });
  await page.click('项目授权'); await field('项目／服务', f.projectId);
  const checkbox = document.querySelector('dialog input[type="checkbox"]') as HTMLInputElement; expect(checkbox.checked).toBe(true);
  await act(async () => checkbox.click()); await page.settle(); await page.click('取消'); await page.click('项目授权');
  expect((document.querySelector('dialog input[type="checkbox"]') as HTMLInputElement).checked).toBe(false);
  await page.click('保存'); expect(f.calls.filter((c) => c.method === 'PUT').at(-1)?.body).toEqual({ projectId: f.projectId, expectedRevision: 7, planIds: [] });
});

async function openLastTask(f: ReturnType<typeof storageFixture>) {
  page = await renderApp(`/projects/${f.projectId}/object-storage`);
  const opener = [...document.querySelectorAll<HTMLButtonElement>('main button')].filter((b) => b.textContent === '查看归档与回收').at(-1)!;
  await act(async () => { opener.focus(); opener.click(); }); await page.settle();
  expect([...document.querySelectorAll('dialog')].at(-1)?.textContent).toContain('业务报告 30');
  return opener;
}
async function dismissTop() {
  await act(async () => [...document.querySelectorAll('dialog')].at(-1)!.dispatchEvent(new Event('cancel', { cancelable: true })));
  await page!.settle();
}
test('unfinalized tasks are reachable without archive history; viewing never changes storage and unauthorized operators have no action', async () => {
  const f = storageFixture(); f.task.finalization = null;
  const opener = await openLastTask(f), table = opener.closest('table');
  expect(page!.text()).toContain('此任务尚未受理终结');
  expect([...document.querySelectorAll('button')].some((b) => b.textContent === '代为终结任务')).toBe(false);
  await dismissTop(); expect(document.activeElement === opener).toBe(true); expect(opener.closest('table') === table).toBe(true);
  expect(f.calls.every((call) => call.method === 'GET')).toBe(true);
});
test('operator finalization requires explicit choices, preserves cancelled drafts, previews unknown execution and retries the same confirmed request', async () => {
  const f = storageFixture(); f.task.finalization = null; f.task.canOperateStorage = true;
  await openLastTask(f); await page!.click('代为终结任务');
  await page!.click('预览终结'); expect(page!.text()).toContain('请选择业务结局'); expect(f.calls.every((call) => call.method === 'GET')).toBe(true);
  await field('业务结局', 'cancelled'); await field('代为终结的原因', '应用已下线，需要结束任务');
  await field('产物处理方式', 'empty'); await field('无需保留产物的原因', '专用验收任务没有业务产物');
  await dismissTop(); await page!.click('代为终结任务');
  expect((document.querySelector('dialog:last-of-type textarea') as HTMLTextAreaElement)?.value).toBe('应用已下线，需要结束任务');
  await page!.click('预览终结'); expect(document.querySelectorAll('dialog')).toHaveLength(3);
  const confirmation = [...document.querySelectorAll('dialog')].at(-1)!;
  expect(confirmation.textContent).toContain('未结束执行: 2'); expect(confirmation.textContent).toContain('状态未知执行: 1');
  expect(confirmation.textContent).toContain('现有执行不会被自动取消');
  expect([...confirmation.querySelectorAll('button')].find((b) => b.textContent === '确认终结')?.disabled).toBe(true);
  await dismissTop(); expect(document.querySelectorAll('dialog')).toHaveLength(2); expect(f.calls.every((call) => call.method === 'GET')).toBe(true);
  await page!.click('预览终结'); await field('输入 delete 以确认', 'delete');
  f.behavior.failWrites = true; await page!.click('确认终结');
  const first = f.calls.filter((call) => call.url.pathname.endsWith('/finalize'))[0]!;
  expect(first.body).toMatchObject({ expectedGeneration: 2, outcome: 'cancelled', confirmation: 'finalize', archive: { noArtifactsReason: '专用验收任务没有业务产物' } });
  expect(page!.text()).toContain('配置修订已变化'); expect(document.querySelectorAll('dialog')).toHaveLength(3);
  f.behavior.failWrites = false; await page!.click('确认终结');
  expect(f.calls.filter((call) => call.url.pathname.endsWith('/finalize')).at(-1)?.body).toEqual(first.body);
  expect(document.querySelectorAll('dialog')).toHaveLength(1); expect(page!.text()).toContain('已受理'); expect(page!.text()).not.toContain('终结完成');
});
test('file finalization prepares only explicitly named relative files and carries the sealed plan into confirmation', async () => {
  const f = storageFixture(); f.task.finalization = null; f.task.canOperateStorage = true;
  await openLastTask(f); await page!.click('代为终结任务');
  await field('业务结局', 'succeeded'); await field('代为终结的原因', '报告已完成'); await field('产物处理方式', 'files');
  await field('文件路径 1', '../secret'); await field('下载名称 1', '报告.txt'); await page!.click('预览终结');
  expect(f.calls.some((call) => call.method === 'POST')).toBe(false);
  await field('文件路径 1', 'reports/output.txt'); await page!.click('预览终结');
  const plan = f.calls.find((call) => call.url.pathname.endsWith('/archive-plans'))!;
  expect(plan.body).toMatchObject({ entries: [{ kind: 'file', path: 'reports/output.txt', name: '报告.txt', required: true }] });
  expect([...document.querySelectorAll('dialog')].at(-1)!.textContent).toContain('reports/output.txt');
  expect(f.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  await field('输入 delete 以确认', 'delete'); await page!.click('确认终结');
  expect(f.calls.find((call) => call.url.pathname.endsWith('/finalize'))?.body?.archive).toMatchObject({ planRevision: 1, digest: 'c'.repeat(64) });
});
test('loss review preserves drafts and requires reason, immutable reviewed scope and a typed nested confirmation; retries reuse the request', async () => {
  const f = storageFixture(); f.task.canOperateStorage = true;
  f.task.finalization = { ...f.task.finalization!, phase: 'draining', receipt: null, computeStopped: false, artifactsReady: false };
  await openLastTask(f); await page!.click('确认数据损失并清理');
  expect(page!.text()).toContain('report.txt'); expect(page!.text()).toContain('执行停止尚未确认');
  await page!.click('预览损失确认'); expect(page!.text()).toContain('请填写明确的损失原因'); expect(f.calls.every((call) => call.method === 'GET')).toBe(true);
  await field('接受数据损失的原因', '工作卷损坏，确认报告无法恢复'); await dismissTop(); await page!.click('确认数据损失并清理');
  expect((document.querySelector('dialog:last-of-type textarea') as HTMLTextAreaElement).value).toBe('工作卷损坏，确认报告无法恢复');
  await page!.click('预览损失确认'); expect(document.querySelectorAll('dialog')).toHaveLength(3);
  const confirmation = [...document.querySelectorAll('dialog')].at(-1)!;
  expect(confirmation.textContent).toContain('损失确认不能代替执行停止或底层回收证明');
  expect([...confirmation.querySelectorAll('button')].find((b) => b.textContent === '接受损失并继续清理')?.disabled).toBe(true);
  await field('输入 discard 以确认', 'discard');
  f.loss.assessmentDigest = 'f'.repeat(64); await page!.reread();
  expect(confirmation.textContent).toContain('文件、引用或停止状态已变化');
  expect([...confirmation.querySelectorAll('button')].find((b) => b.textContent === '接受损失并继续清理')?.disabled).toBe(true);
  await dismissTop(); expect(document.querySelectorAll('dialog')).toHaveLength(2); expect(f.calls.every((call) => call.method === 'GET')).toBe(true);
  await page!.click('预览损失确认'); await field('输入 discard 以确认', 'discard');
  f.behavior.failWrites = true; await page!.click('接受损失并继续清理');
  const request = f.calls.filter((call) => call.url.pathname.endsWith('/confirm-loss'))[0]!.body;
  expect(request).toMatchObject({ expectedRevision: 1, assessmentDigest: f.loss.assessmentDigest, confirmation: 'accept-loss', reason: '工作卷损坏，确认报告无法恢复' });
  expect(page!.text()).toContain('配置修订已变化'); expect(document.querySelectorAll('dialog')).toHaveLength(3);
  f.behavior.failWrites = false; await page!.click('接受损失并继续清理');
  expect(f.calls.filter((call) => call.url.pathname.endsWith('/confirm-loss')).at(-1)!.body).toEqual(request);
  expect(document.querySelectorAll('dialog')).toHaveLength(1); expect(page!.text()).toContain('损失确认已受理，继续等待执行停止和存储回收');
  expect(page!.text()).not.toContain('终结完成');
});
test('completed loss remains visibly distinct from successful archive and never offers ordinary finalization again', async () => {
  const f = storageFixture(); f.task.canOperateStorage = true;
  f.task.finalization = { ...f.task.finalization!, phase: 'completed', artifactsReady: false, storageReclaimed: true, volumeDisposition: 'deleted',
    receipt: { ...f.task.finalization!.receipt!, disposition: 'loss', lossActorId: UserIdSchema.parse(Bun.randomUUIDv7()), lossReason: '报告已确认损失' } };
  await openLastTask(f); expect(page!.text()).toContain('终结完成（有数据损失）'); expect(page!.text()).toContain('报告已确认损失');
  const facts = [...document.querySelectorAll('dialog dl > div')];
  expect(facts.find((row) => row.querySelector('dt')?.textContent === '归档产物就绪')?.querySelector('dd')?.textContent).toBe('尚未确认');
  expect([...document.querySelectorAll('dialog button')].some((b) => b.textContent === '确认数据损失并清理' || b.textContent === '代为终结任务')).toBe(false);
});
test('manifest revision shows all discarded required paths in pages and sends discard consent only after typed confirmation', async () => {
  const f = storageFixture(); f.task.canOperateStorage = true; f.task.finalization = { ...f.task.finalization!, phase: 'archiving', receipt: null, artifactsReady: false };
  await openLastTask(f); await page!.click('修订归档清单');
  await field('修订清单的原因', '原清单指定了不存在的文件'); await field('产物处理方式', 'empty'); await field('无需保留产物的原因', '已人工确认无报告需要保留');
  await page!.click('预览清单变更'); expect(document.querySelectorAll('dialog')).toHaveLength(3);
  expect(page!.text()).toContain('全部 101 个必需文件'); expect(page!.text()).toContain('report-0.txt');
  expect(f.calls.some((call) => call.url.pathname.endsWith('/revise-archive'))).toBe(false);
  await page!.click('下一页'); expect(page!.text()).toContain('report-100.txt');
  expect(f.calls.filter((call) => call.url.pathname.endsWith('/archive-revision-preview')).at(-1)?.body?.offset).toBe(100);
  await dismissTop(); expect(document.querySelectorAll('dialog')).toHaveLength(2);
  expect((document.querySelector('dialog:last-of-type textarea') as HTMLTextAreaElement).value).toBe('原清单指定了不存在的文件');
  await page!.click('预览清单变更'); await field('输入 discard 以确认', 'discard');
  f.behavior.failWrites = true; await page!.click('确认修订');
  const request = f.calls.filter((call) => call.url.pathname.endsWith('/revise-archive'))[0]!.body;
  expect(request).toMatchObject({ expectedRevision: 1, expectedGeneration: 2, confirmDiscard: true, reason: '原清单指定了不存在的文件', archive: { noArtifactsReason: '已人工确认无报告需要保留' } });
  expect(page!.text()).toContain('配置修订已变化'); f.behavior.failWrites = false; await page!.click('确认修订');
  expect(f.calls.filter((call) => call.url.pathname.endsWith('/revise-archive')).at(-1)!.body).toEqual(request);
  expect(document.querySelectorAll('dialog')).toHaveLength(1); expect(f.task.finalization!.revision).toBe(2);
});
test('credential rotation preserves cancelled drafts, masks values and requires typed confirmation before an exact-key retry', async () => {
  const f = storageFixture(); page = await renderApp('/admin/object-storage'); await page.click('轮换凭据');
  await page.click('预览凭据轮换'); expect(page.text()).toContain('请填写新的 Access Key');
  await field('Access Key', 'new-access'); await field('Secret Key', 'new-private-secret'); await field('轮换原因', '例行轮换');
  expect((document.querySelector('dialog input') as HTMLInputElement).type).toBe('password');
  await dismissTop(); await page.click('轮换凭据'); expect((document.querySelector('dialog input') as HTMLInputElement).value).toBe('new-access');
  await page.click('预览凭据轮换'); expect(document.querySelectorAll('dialog')).toHaveLength(2); expect(page.text()).not.toContain('new-private-secret');
  expect(page.text()).toContain('不会自动撤销后端旧密钥'); expect(f.calls.every((c) => c.method === 'GET')).toBe(true);
  await dismissTop(); expect(document.querySelectorAll('dialog')).toHaveLength(1); await page.click('预览凭据轮换'); await field('输入 rotate 以确认', 'rotate');
  f.behavior.failWrites = true; await page.click('确认轮换');
  const first = f.calls.find((call) => call.url.pathname.endsWith('/rotate-credential'))!.body;
  expect(first).toMatchObject({ expectedRevision: 1, accessKeyId: 'new-access', secretAccessKey: 'new-private-secret', reason: '例行轮换', confirmation: 'rotate' }); expect(first).not.toHaveProperty('endpoint');
  f.behavior.failWrites = false; await page.click('确认轮换');
  expect(f.calls.filter((call) => call.url.pathname.endsWith('/rotate-credential')).at(-1)!.body).toEqual(first); expect(document.querySelectorAll('dialog')).toHaveLength(0);
  await page.click('轮换凭据'); expect((document.querySelector('dialog input') as HTMLInputElement).value).toBe('');
});
test('artifact deletion keeps the receipt visible and requires a completed task and typed confirmation; failed retry preserves the exact request', async () => {
  const f = storageFixture(); f.task.canOperateStorage = true; f.task.finalization!.phase = 'completed';
  await openLastTask(f);
  await page!.click('删除任务产物集'); await field('删除原因', '产物已外部留存'); await dismissTop();
  await page!.click('删除任务产物集'); expect((document.querySelector('dialog:last-of-type input') as HTMLInputElement).value).toBe('产物已外部留存');
  await page!.click('预览产物删除'); expect(document.querySelectorAll('dialog')).toHaveLength(3);
  expect(f.calls.every((call) => call.method === 'GET')).toBe(true);
  await dismissTop(); expect(document.querySelectorAll('dialog')).toHaveLength(2);
  await page!.click('预览产物删除'); await field('输入 delete 以确认', 'delete');
  f.behavior.failWrites = true; await page!.click('删除任务产物集');
  const request = f.calls.find((call) => call.url.pathname.endsWith('/delete-artifacts'))!.body;
  expect(request).toMatchObject({ expectedReceiptId: f.task.finalization!.receipt!.id, reason: '产物已外部留存', confirmation: 'delete' });
  f.behavior.failWrites = false; await page!.click('删除任务产物集');
  expect(f.calls.filter((call) => call.url.pathname.endsWith('/delete-artifacts')).at(-1)!.body).toEqual(request);
  expect(document.querySelectorAll('dialog')).toHaveLength(1); expect(page!.text()).toContain('1 个对象因其他引用继续保留');
  expect(document.querySelectorAll('dialog a[download]')).toHaveLength(0); expect(page!.text()).toContain('report.txt');
});
