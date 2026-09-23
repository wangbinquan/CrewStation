import type { FetchLike } from '@crewstation/api-client';
import type { ClusterAccess, ClusterResult } from '../cluster/clusterAccess';
import type { FileAccess } from '../runtime/commandContext';
import { runCli } from '../runtime/dispatch';

export interface Captured {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: unknown;
}

export interface FakeFetch {
  readonly calls: Captured[];
  readonly fetchImpl: FetchLike;
}

/** 记录请求并按脚本应答；命令测试一律用它，不碰真实网络。 */
export function fakeFetch(respond: (captured: Captured) => Response): FakeFetch {
  const calls: Captured[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const captured: Captured = {
      url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body,
    };
    calls.push(captured);
    return respond(captured);
  };
  return { calls, fetchImpl };
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

/** 路由表：`GET /v1/projects` → 应答。命中不到就返回 404 错误体，暴露多余的调用。 */
export function routes(table: Readonly<Record<string, Response | (() => Response)>>): (captured: Captured) => Response {
  return (captured) => {
    const path = captured.url.replace(/^https?:\/\/[^/]+/, '');
    const hit = table[`${captured.method} ${path}`];
    if (hit === undefined) return jsonResponse(404, { error: 'not_found', message: `测试路由表里没有 ${captured.method} ${path}`, details: {} });
    // clone 允许同一条路由被命中多次；它的返回类型来自 undici 的声明，与 Bun 的全局 Response 不是同一个。
    return typeof hit === 'function' ? hit() : (hit.clone() as unknown as Response);
  };
}

export function memoryFiles(files: Readonly<Record<string, string>>, dirs: readonly string[] = []): FileAccess {
  const known = new Set([...Object.keys(files), ...dirs]);
  return {
    readText: (path) => files[path],
    exists: (path) => known.has(path),
    listDir: (path) => Object.keys(files).filter((item) => item.startsWith(path + '/')).map((item) => item.slice(path.length + 1)),
  };
}

const OK: ClusterResult = { code: 0, stdout: '', stderr: '' };

/** 按 kubectl 参数前缀匹配的假集群；未命中返回失败，免得测试误以为某步成功了。 */
export function fakeCluster(script: Readonly<Record<string, ClusterResult>>, target = 'kubectl（测试）'): ClusterAccess & { readonly commands: string[]; readonly inputs: Record<string, string> } {
  const commands: string[] = [];
  const inputs: Record<string, string> = {};
  return {
    target,
    commands,
    inputs,
    run: async (args, input) => {
      const key = args.join(' ');
      commands.push(key);
      if (input !== undefined) inputs[`${commands.length - 1}`] = input;
      const hit = Object.entries(script).find(([prefix]) => key.startsWith(prefix));
      return hit?.[1] ?? { code: 1, stdout: '', stderr: `测试脚本里没有 kubectl ${key}` };
    },
  };
}

export const clusterOk = (stdout = ''): ClusterResult => ({ ...OK, stdout });

export interface RunOutcome {
  readonly code: number;
  readonly out: string[];
  readonly err: string[];
  readonly calls: readonly Captured[];
  readonly kubectl: readonly string[];
}

export interface RunOptions {
  readonly respond?: (captured: Captured) => Response;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly files?: FileAccess;
  readonly cluster?: ClusterAccess & { readonly commands: string[] };
  readonly isTty?: boolean;
  readonly homeDir?: string;
}

export async function runForTest(argv: readonly string[], options: RunOptions = {}): Promise<RunOutcome> {
  const out: string[] = [];
  const err: string[] = [];
  const fetcher = fakeFetch(options.respond ?? (() => jsonResponse(500, { error: 'internal', message: '测试未提供应答', details: {} })));
  const code = await runCli({
    argv,
    env: options.env ?? { CS_TOKEN: 'test-token' },
    io: { out: (line) => out.push(line), err: (line) => err.push(line) },
    isTty: options.isTty ?? false,
    homeDir: options.homeDir ?? '/home/tester',
    files: options.files ?? memoryFiles({}),
    fetch: fetcher.fetchImpl,
    ...(options.cluster === undefined ? {} : { cluster: () => options.cluster as ClusterAccess }),
  });
  return { code, out, err, calls: fetcher.calls, kubectl: options.cluster?.commands ?? [] };
}
