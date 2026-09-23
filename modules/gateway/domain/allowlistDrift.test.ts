import { describe, expect, test } from 'bun:test';
import { allowlistDrift } from './allowlistDrift';

type Content = Parameters<typeof allowlistDrift>[1];

const op = (n: number) => `01a0bf5d-8f4b-7155-8e96-d9844e02df${String(n).padStart(2, '0')}`;
const route = (n: number) => ({ id: op(n), proxy: 'issues', method: 'GET', path: `/v1/items/${n}` });
const entry = (caller: string, operations: string[], platformHosts: Array<'platformApi' | 'events' | 'mcpCapabilities' | 'mcpOperations'> = ['platformApi']) => ({ caller, operations, platformApi: true, platformHosts });
const content = (value: unknown): Content => value as Content;
const base = content({ operationRoutes: [route(1), route(2)], defaultOpen: [op(2), op(1)], entries: [entry('demo/demo', [op(1), op(2)]), entry('issues/issues', [])] });

describe('放行表的定时核对（RFC-025 设计 §7.4）', () => {
  test('内容一样、只是先后不同：没有出入', () => {
    const reordered = content({ operationRoutes: [route(2), route(1)], defaultOpen: [op(1), op(2)], entries: [entry('issues/issues', []), entry('demo/demo', [op(2), op(1)])] });
    expect(allowlistDrift(base, reordered)).toEqual({ callers: [], global: false });
  });

  test('某个调用方的授权或可达端点变了、调用方多了或少了：只列这些调用方', () => {
    const changed = content({ ...base, entries: [entry('demo/demo', [op(1)]), entry('issues/issues', [], ['platformApi', 'events']), entry('newbie/newbie', [])] });
    expect(allowlistDrift(base, changed)).toEqual({ callers: ['demo/demo', 'issues/issues', 'newbie/newbie'], global: false });
    expect(allowlistDrift(base, content({ ...base, entries: [entry('demo/demo', [op(1), op(2)])] }))).toEqual({ callers: ['issues/issues'], global: false });
  });

  test('默认开放的操作或操作路由变了：影响所有调用方；没有最新一版时全部算不一致', () => {
    expect(allowlistDrift(base, content({ ...base, defaultOpen: [op(1)] })).global).toBe(true);
    expect(allowlistDrift(base, content({ ...base, operationRoutes: [route(1), { ...route(2), path: '/v2/items/2' }] })).global).toBe(true);
    expect(allowlistDrift(undefined, base)).toEqual({ callers: ['demo/demo', 'issues/issues'], global: true });
  });
});
