import { AsyncLocalStorage } from 'node:async_hooks';
import { ProjectDeletionContextSchema } from '@crewstation/contracts';
import type { ProjectDeletionContext } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import { GitLabNativeInventorySchema, GitLabFootprintSchema } from '@crewstation/gitlab-client';
import { z } from 'zod';

const material = z.strictObject({ native: GitLabNativeInventorySchema, footprint: GitLabFootprintSchema });
type Grant = { context: ProjectDeletionContext; materials: z.infer<typeof material>[] };
const mutationPaths = new Set(['/native/gitlab/fence', '/native/gitlab/destruction', '/native/gitlab/storage/remove']);

/** The native SDK remains domain-free; this root binds each mutation to its
 * original controller context, even when independent requests run concurrently. */
export function nativeScopeTransport(fetcher: typeof fetch = fetch) {
  const grants = new AsyncLocalStorage<Grant>();
  const request: typeof fetch = Object.assign(async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const target = new URL(String(url));
    if (!mutationPaths.has(target.pathname)) return fetcher(url, init);
    const query = JSON.parse(String(init?.body));
    if (target.pathname === '/native/gitlab/destruction' && query.mode === 'observe') return fetcher(url, init);
    const grant = grants.getStore();
    if (!grant) throw precondition('原 GitLab 物理请求缺少当前项目删除许可');
    const body = JSON.stringify({ ...grant, request: query });
    if (Buffer.byteLength(body) > 25_165_824) throw precondition('原 GitLab 删除材料超出完整传输预算');
    return fetcher(url, { ...init, body });
  }, { preconnect: fetcher.preconnect });
  return { fetch: request, run: <T>(raw: ProjectDeletionContext,
    retained: readonly { contents: string }[] | undefined, work: () => Promise<T>) => {
    const context = ProjectDeletionContextSchema.parse(structuredClone(raw));
    if (context.confirmed.participant !== 'scm' || !['stop', 'purge'].includes(context.phase) || !retained) throw precondition('原 GitLab 删除许可或持久材料缺失');
    const materials = retained.map(row => material.parse(JSON.parse(row.contents)));
    return grants.run({ context, materials }, work);
  } };
}
