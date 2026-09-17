import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createApiClient } from '@crewstation/api-client';
import { consoleSources } from './sourceScan';

/**
 * 前台与平台之间的接口面锁。
 *
 * 渲染用例只把 `fetch` 打桩，桩的响应是手写的：后端把一条路由改名或删掉，那些用例照样是绿的，
 * 线上却直接 404。这里把两侧真实对账——客户端实际构造出来的每条路径，都必须在某个模块的
 * http 路由里声明过。谁改了路由忘了改前台（或反过来），门禁当场红。
 *
 * 只做「客户端 ⊆ 后端」这一个方向：后端还有 internal／网关等前台不调的路由，不该被算成缺口。
 */

const REPO = join(import.meta.dir, '..', '..', '..', '..');
/** 调用每个方法时塞进去的占位实参；出现在哪一段，哪一段就是路径参数。 */
const ARGS = ['ARGALPHA', 'ARGBRAVO', 'ARGCHARLIE', 'ARGDELTA'] as const;

/** `:projectId` 与 `:userId` 对账时只是「一个参数」，统一成 `:p` 再比。 */
function normalizePath(path: string): string {
  const normalized = path
    .replace(/\*$/, '')
    .split('/')
    .map((segment) => (segment.startsWith(':') ? ':p' : segment))
    .join('/')
    .replace(/\/+$/, '');
  return normalized === '' ? '/' : normalized;
}

/** 录下来的路径里，凡是含占位实参的段都是参数段。 */
function normalizeRecorded(pathname: string): string {
  const decoded = decodeURIComponent(pathname);
  const normalized = decoded
    .split('/')
    .map((segment) => (ARGS.some((arg) => segment.includes(arg)) ? ':p' : segment))
    .join('/')
    .replace(/\/+$/, '');
  return normalized === '' ? '/' : normalized;
}

function moduleHttpFiles(): string[] {
  const modulesDir = join(REPO, 'modules');
  return readdirSync(modulesDir).flatMap((moduleName) => {
    const httpDir = join(modulesDir, moduleName, 'http');
    try {
      if (!statSync(httpDir).isDirectory()) return [];
    } catch {
      return [];
    }
    return readdirSync(httpDir)
      .filter((entry) => entry.endsWith('.ts'))
      .map((entry) => join(httpDir, entry));
  });
}

/** 模块里声明过的全部路由；路由都是全路径注册（`app.route('/', router)`），不必还原前缀。 */
function backendRoutes(): Set<string> {
  const routes = new Set<string>();
  const pattern = /\.(get|post|put|patch|delete)\(\s*'([^']+)'/g;
  for (const file of moduleHttpFiles()) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(pattern)) {
      const path = match[2] ?? '';
      if (!path.startsWith('/')) continue;
      routes.add(`${(match[1] ?? '').toUpperCase()} ${normalizePath(path)}`);
    }
  }
  return routes;
}

/** 用假 fetch 驱动真实客户端，把它构造出来的路径录下来。 */
async function clientRoutes(): Promise<Set<string>> {
  const recorded = new Set<string>();
  const client = createApiClient({
    baseUrl: 'http://api.test',
    fetch: async (input, init) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      // 实参形状不合适时会拼出 `undefined`／`[object Object]`（在 URL 里是百分号编码的）；
      // 那是这一发没打中，不是客户端真实路径，先解码再剔除。
      const pathname = decodeURIComponent(new URL(raw).pathname);
      if (!/undefined|\[object/.test(pathname)) recorded.add(`${method} ${normalizeRecorded(pathname)}`);
      return new Response('{"items":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  // 不同方法的实参形状不同（id、输入对象、查询对象）；逐个形状试一遍，只要路径被构造出来就录到。
  const shapes: unknown[][] = [
    [ARGS[0], ARGS[1], ARGS[2]],
    [ARGS[0], ARGS[1], {}],
    [ARGS[0], {}],
    [ARGS[0]],
    [{}],
    [],
  ];
  for (const resource of Object.values(client)) {
    if (typeof resource !== 'object' || resource === null) continue;
    for (const candidate of Object.values(resource as Record<string, unknown>)) {
      if (typeof candidate !== 'function') continue;
      for (const shape of shapes) {
        try {
          await (candidate as (...args: unknown[]) => unknown)(...shape);
        } catch {
          // 实参形状不合适只是这一发没打中；路径若已构造就已经录下来了。
        }
      }
    }
  }
  return recorded;
}

describe('前台调用的接口都在平台路由里（接口面锁）', () => {
  test('客户端构造的每条路径都有对应的后端路由声明', async () => {
    const backend = backendRoutes();
    const client = await clientRoutes();
    expect(backend.size).toBeGreaterThan(100);
    expect(client.size).toBeGreaterThan(50);
    const missing = [...client].filter((route) => !backend.has(route)).sort();
    expect(missing).toEqual([]);
  });

  test('控制台里绕开客户端的裸 fetch 也指向真实路由', () => {
    const backend = backendRoutes();
    const pattern = /fetch\(\s*`([^`]+)`/g;
    const called: string[] = [];
    for (const source of consoleSources()) {
      for (const match of source.code.matchAll(pattern)) {
        const raw = match[1] ?? '';
        if (!raw.startsWith('/v1/')) continue;
        called.push(normalizeRecorded(raw.replace(/\$\{[^}]*\}/g, ARGS[0]).split('?')[0] ?? ''));
      }
    }
    // 绕开客户端是例外，不是常态；数量失控时这条断言会提醒把它收回 api-client。
    expect(called.length).toBeLessThanOrEqual(3);
    const missing = called.filter((path) => ![...backend].some((route) => route.endsWith(` ${path}`))).sort();
    expect(missing).toEqual([]);
  });
});
