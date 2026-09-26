import { afterEach, describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import type { ResourceView } from '@crewstation/contracts';
import { queryKeys } from '../shared/api/queryKeys';
import type { ProjectResourceSource } from '../shared/resources/projectResourceStreams';
import { retainProjectResources } from '../shared/resources/projectResourceStreams';
import { ResourceStreamConnection } from '../shared/resources/resourceStream';
import { applyResourceEvent, terminalRecord } from '../shared/resources/resourceViewState';
import { FakeEventSource, resourceRecord, resourceView } from './resourceRecordFixture';

// RFC-025 设计 §8、§10：工作台的资源视图——快照＋推送流合进同一份缓存，一个项目一条连接，reset 与断线重读快照后从新游标续上。
const projectId = '01a0bf5d-8f4b-7e1e-8dde-c9c2ae13ed34';
const ws = resourceRecord({ id: '01a0bf5d-8f4b-7e1e-8dde-c9c2ae13e001' });
const cli = resourceRecord({ id: '01a0bf5d-8f4b-7e1e-8dde-c9c2ae13e002', kind: 'agent-execution', purpose: 'development-cli', parentId: ws.id, display: { terminal: 'term-1' } });
const wait = async (predicate: () => boolean, ms = 1_000) => { const deadline = Date.now() + ms; while (!predicate() && Date.now() < deadline) await Bun.sleep(5); expect(predicate()).toBe(true); };
afterEach(() => { FakeEventSource.reset(); });

describe('资源视图的合并（纯函数）', () => {
  const view = resourceView([ws, cli], 10);
  test('快照整体替换；增量按 ID 原位替换或追加，游标只进不退；移除；心跳不变；reset 要求重读', () => {
    expect(applyResourceEvent(view, { type: 'snapshot', items: [cli], counts: { 'agent-execution': { ready: 1 } }, cursor: 3 })).toEqual({ items: [cli], counts: { 'agent-execution': { ready: 1 } }, cursor: 3 });
    const stopping = { ...cli, phase: 'stopping' as const, version: 2 };
    expect(applyResourceEvent(view, { type: 'upsert', record: stopping, counts: {}, cursor: 11 })).toEqual({ items: [ws, stopping], counts: {}, cursor: 11 });
    const extra = resourceRecord({ id: '01a0bf5d-8f4b-7e1e-8dde-c9c2ae13e003' });
    expect(applyResourceEvent(view, { type: 'upsert', record: extra, counts: {}, cursor: 12 })?.items).toEqual([ws, cli, extra]);
    expect(applyResourceEvent(view, { type: 'remove', id: cli.id, counts: {}, cursor: 13 })).toEqual({ items: [ws], counts: {}, cursor: 13 });
    expect(applyResourceEvent(view, { type: 'heartbeat', at: '2026-09-23T12:00:00.000Z' })).toBe(view);
    expect(applyResourceEvent(view, { type: 'reset', reason: 'overflow' })).toBeUndefined();
  });
  test('旧版本不盖新版本（重连补发与快照交错）：记录不变，游标照样前进', () => {
    const newer = resourceView([{ ...cli, version: 5, phase: 'stopped' }], 20);
    expect(applyResourceEvent(newer, { type: 'upsert', record: { ...cli, version: 4 }, counts: {}, cursor: 21 })).toEqual({ ...newer, cursor: 21 });
  });
  test('终端对应的执行记录：只看 Agent 执行、按展示字段 terminal 对上，同一终端取最新建的', () => {
    const later = { ...cli, id: '01a0bf5d-8f4b-7e1e-8dde-c9c2ae13e004', createdAt: '2026-09-23T13:00:00.000Z' };
    expect(terminalRecord([ws, cli, later], 'term-1')).toBe(later);
    expect(terminalRecord([ws, { ...ws, display: { terminal: 'term-1' } }], 'term-1')).toBeUndefined();
    expect(terminalRecord([cli], 'term-9')).toBeUndefined();
  });
});

describe('一条推送流连接', () => {
  const connect = () => {
    const events: string[] = [], restarts: string[] = [];
    const connection = new ResourceStreamConnection({ url: (cursor) => `/stream?cursor=${cursor}`, open: (url) => new FakeEventSource(url), onEvent: (event) => events.push(event.type), onRestart: (reason) => restarts.push(reason) });
    return { connection, events, restarts };
  };
  test('从给定游标开流；帧按类型交出；浏览器自己在重连时不打扰（CONNECTING）', () => {
    const { connection, events, restarts } = connect();
    connection.start(7);
    const source = FakeEventSource.opened[0]!;
    expect(source.url).toBe('/stream?cursor=7'); expect(connection.active).toBe(true);
    source.emit({ type: 'upsert', record: cli, counts: {}, cursor: 8 }); source.emit({ type: 'heartbeat', at: '2026-09-23T12:00:00.000Z' });
    source.fail(false);
    expect(events).toEqual(['upsert', 'heartbeat']); expect(restarts).toEqual([]); expect(connection.active).toBe(true);
  });
  test('reset、连接关闭（不再自己重连）与看不懂的帧都交给调用方重读；之后旧连接的帧不再算数', () => {
    const { connection, events, restarts } = connect();
    connection.start(1); const first = FakeEventSource.opened[0]!;
    first.emit({ type: 'reset', reason: 'overflow' });
    expect(restarts).toEqual(['reset']); expect(first.readyState).toBe(2); expect(connection.active).toBe(false);
    first.emit({ type: 'upsert', record: cli, counts: {}, cursor: 2 });
    connection.start(2); FakeEventSource.opened[1]!.fail(true);
    connection.start(3); FakeEventSource.opened[2]!.emitRaw('upsert', '{"type":"upsert"}');
    expect(restarts).toEqual(['reset', 'closed', 'closed']); expect(events).toEqual([]);
  });
});

describe('项目的推送流登记（引用计数、缓存合并、重读后续传）', () => {
  test('全平台流与项目流隔离缓存，共用连接，reset 仍从全平台新游标续传', async () => {
    const client = new QueryClient(), adminKey = queryKeys.adminResources(), projectKey = queryKeys.projectResources(projectId);
    client.setQueryData(adminKey, resourceView([ws], 10)); client.setQueryData(projectKey, resourceView([cli], 3));
    const source: ProjectResourceSource = { queryKey: adminKey, view: async () => resourceView([ws, cli], 30), streamUrl: (_id, cursor) => `/admin/stream?cursor=${cursor}`, open: (url) => new FakeEventSource(url), releaseDelayMs: 0, restartDelaysMs: [0] };
    const releaseA = retainProjectResources(client, 'admin', source), releaseB = retainProjectResources(client, 'admin', source);
    const releaseProject = retainProjectResources(client, projectId, { ...source, queryKey: projectKey, streamUrl: (_id, cursor) => `/project/stream?cursor=${cursor}` });
    expect(FakeEventSource.opened.map((s) => s.url)).toEqual(['/admin/stream?cursor=10', '/project/stream?cursor=3']);
    FakeEventSource.opened[0]!.emit({ type: 'upsert', record: { ...ws, phase: 'stopping', version: 2 }, counts: {}, cursor: 11 });
    expect(client.getQueryData<ResourceView>(projectKey)).toEqual(resourceView([cli], 3));
    expect(client.getQueryData<ResourceView>(adminKey)?.items[0]?.phase).toBe('stopping');
    FakeEventSource.opened[0]!.emit({ type: 'reset', reason: 'overflow' });
    await wait(() => FakeEventSource.opened.length === 3);
    expect(FakeEventSource.opened[2]!.url).toBe('/admin/stream?cursor=30');
    expect(client.getQueryData<ResourceView>(adminKey)).toEqual(resourceView([ws, cli], 30));
    releaseA(); releaseB(); releaseProject(); await wait(() => FakeEventSource.opened.every((s) => s.readyState === 2)); client.clear();
  });
  const setup = (views: ResourceView[]) => {
    const client = new QueryClient(), reads: number[] = [];
    client.setQueryData(queryKeys.projectResources(projectId), resourceView([ws, cli], 10));
    const source: ProjectResourceSource = {
      view: async () => { reads.push(Date.now()); return views.shift() ?? resourceView([], 99); }, streamUrl: (_id, cursor) => `/v1/projects/${projectId}/resources/stream?cursor=${cursor}`,
      open: (url) => new FakeEventSource(url), releaseDelayMs: 20, restartDelaysMs: [5, 5],
    };
    const cached = () => client.getQueryData<ResourceView>(queryKeys.projectResources(projectId))!;
    return { client, source, reads, cached };
  };
  test('同一项目的多个使用者共用一条连接；事件原位合进缓存；最后一个离开后稍等才断开，期间回来的不重连', async () => {
    const { client, source, cached } = setup([]);
    const releaseA = retainProjectResources(client, projectId, source), releaseB = retainProjectResources(client, projectId, source);
    expect(FakeEventSource.opened.map((s) => s.url)).toEqual([`/v1/projects/${projectId}/resources/stream?cursor=10`]);
    FakeEventSource.opened[0]!.emit({ type: 'upsert', record: { ...cli, phase: 'stopping', version: 2 }, counts: {}, cursor: 11 });
    expect(cached().items.find((r) => r.id === cli.id)?.phase).toBe('stopping'); expect(cached().cursor).toBe(11);
    releaseA(); releaseA(); releaseB();
    const again = retainProjectResources(client, projectId, source);
    await Bun.sleep(40);
    expect(FakeEventSource.opened).toHaveLength(1); expect(FakeEventSource.opened[0]!.readyState).toBe(1);
    again(); await Bun.sleep(40);
    expect(FakeEventSource.opened[0]!.readyState).toBe(2);
  });
  test('服务端 reset：先重读快照写回缓存，再从快照的游标开新连接', async () => {
    const { client, source, reads, cached } = setup([resourceView([ws], 30)]);
    const release = retainProjectResources(client, projectId, source);
    FakeEventSource.opened[0]!.emit({ type: 'reset', reason: 'overflow' });
    await wait(() => FakeEventSource.opened.length === 2);
    expect(reads).toHaveLength(1); expect(cached()).toEqual(resourceView([ws], 30));
    expect(FakeEventSource.opened[1]!.url).toBe(`/v1/projects/${projectId}/resources/stream?cursor=30`);
    release();
  });
  test('重读失败按退避再试；没人用了就不再开', async () => {
    const { client, source, reads } = setup([]);
    let fail = true;
    const failing: ProjectResourceSource = { ...source, view: async () => { reads.push(1); if (fail) throw new Error('503'); return resourceView([ws], 40); } };
    const release = retainProjectResources(client, projectId, failing);
    FakeEventSource.opened[0]!.fail(true);
    await wait(() => reads.length >= 2);
    fail = false;
    await wait(() => FakeEventSource.opened.length === 2);
    expect(FakeEventSource.opened[1]!.url).toContain('cursor=40');
    release(); await Bun.sleep(40);
    FakeEventSource.opened[1]!.fail(true); await Bun.sleep(40);
    expect(FakeEventSource.opened).toHaveLength(2);
  });
  test('没有 EventSource 的环境只用快照：登记是空操作', () => {
    const { client, source } = setup([]);
    const { open: _open, ...snapshotOnly } = source;
    retainProjectResources(client, projectId, snapshotOnly)();
    expect(FakeEventSource.opened).toHaveLength(0);
  });
});
