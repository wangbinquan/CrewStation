// RFC-025 项目资源视图的推送流：每个项目（每个 QueryClient）只开一条连接，按引用计数；事件合进 React Query 缓存。
import type { QueryClient } from '@tanstack/react-query';
import type { ResourceView } from '@crewstation/contracts';
import { queryKeys } from '../api/queryKeys';
import type { EventSourceFactory } from './resourceStream';
import { ResourceStreamConnection } from './resourceStream';
import { applyResourceEvent } from './resourceViewState';

/** 取快照、推送流地址与打开连接的方式；没有 EventSource 的环境（用例、老浏览器）不给 open，只用快照。 */
export interface ProjectResourceSource {
  view(projectId: string): Promise<ResourceView>;
  streamUrl(projectId: string, cursor: number): string;
  readonly open?: EventSourceFactory;
  /** 用例缩短等待；缺省见下面两个常量。 */
  readonly releaseDelayMs?: number;
  readonly restartDelaysMs?: readonly number[];
}

/** 最后一个使用者离开后再等一会儿才断开：页签与路由切换时同一项目的页面先卸后装，不必重连。 */
export const RELEASE_DELAY_MS = 5_000;
/** 连接彻底断开或要求重读时的退避：先重读快照，再从新游标开流。收到任何事件就回到第一档。 */
export const RESTART_DELAYS_MS: readonly number[] = [1_000, 2_000, 5_000, 10_000, 30_000];

interface Entry {
  count: number;
  attempts: number;
  restarting: boolean;
  connection?: ResourceStreamConnection;
  closeTimer?: ReturnType<typeof setTimeout>;
  retryTimer?: ReturnType<typeof setTimeout>;
}

const registries = new WeakMap<QueryClient, Map<string, Entry>>();

function projectsOf(client: QueryClient): Map<string, Entry> {
  let projects = registries.get(client);
  if (!projects) registries.set(client, (projects = new Map()));
  return projects;
}

function createEntry(client: QueryClient, projectId: string, source: ProjectResourceSource & { readonly open: EventSourceFactory }): Entry {
  const key = queryKeys.projectResources(projectId), entry: Entry = { count: 0, attempts: 0, restarting: false };
  const delays = source.restartDelaysMs ?? RESTART_DELAYS_MS;
  const restart = () => {
    const delay = delays[Math.min(entry.attempts, delays.length - 1)] ?? 0;
    entry.attempts += 1;
    entry.retryTimer = setTimeout(() => {
      entry.retryTimer = undefined;
      if (entry.count === 0) return;
      entry.restarting = true;
      // 重读快照写回同一个缓存；读失败时查询本身进入错误态，页面照常显示错误，使用者随之离开（计数归零）。
      void client.fetchQuery({ queryKey: key, queryFn: () => source.view(projectId), staleTime: 0 })
        .then((view) => { if (entry.count > 0 && !entry.connection!.active) entry.connection!.start(view.cursor); })
        .catch(() => { if (entry.count > 0) restart(); })
        .finally(() => { entry.restarting = false; });
    }, delay);
  };
  entry.connection = new ResourceStreamConnection({
    url: (cursor) => source.streamUrl(projectId, cursor),
    open: source.open,
    onEvent: (event) => {
      entry.attempts = 0;
      client.setQueryData<ResourceView>(key, (view) => (view ? applyResourceEvent(view, event) ?? view : view));
    },
    onRestart: restart,
  });
  return entry;
}

function dispose(projects: Map<string, Entry>, projectId: string, entry: Entry): void {
  if (entry.count > 0) return;
  entry.connection?.stop();
  if (entry.retryTimer) clearTimeout(entry.retryTimer);
  if (projects.get(projectId) === entry) projects.delete(projectId);
}

/**
 * 登记一个使用者；返回的函数注销它。第一个使用者到来时从缓存里的游标开流（服务端补发之后的变更，
 * 游标过旧就先给快照），此后每个事件原位合进缓存；页面读的始终是同一份视图。
 */
export function retainProjectResources(client: QueryClient, projectId: string, source: ProjectResourceSource): () => void {
  if (!source.open) return () => undefined;
  const projects = projectsOf(client);
  let entry = projects.get(projectId);
  if (!entry) projects.set(projectId, (entry = createEntry(client, projectId, { ...source, open: source.open })));
  const current = entry;
  current.count += 1;
  if (current.closeTimer) { clearTimeout(current.closeTimer); current.closeTimer = undefined; }
  const cached = client.getQueryData<ResourceView>(queryKeys.projectResources(projectId));
  if (cached && !current.connection!.active && !current.restarting && !current.retryTimer) current.connection!.start(cached.cursor);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    current.count -= 1;
    if (current.count === 0) current.closeTimer = setTimeout(() => dispose(projects, projectId, current), source.releaseDelayMs ?? RELEASE_DELAY_MS);
  };
}
