import type { ApiClient } from '@crewstation/api-client';
import { notFound, precondition } from '@crewstation/kernel';
import type { McpCaller } from './callerIdentity';

/** 身份头给的是 slug，平台 API 用的是不透明 ID，所以每个请求要先换一次。 */
export interface CallerProject {
  readonly projectId: string;
  readonly serviceId: string;
  readonly slug: string;
}

/**
 * 用调用方自己的身份去列项目，再按 slug 对上：能不能看到由 cs-api 判定，
 * MCP 不维护任何项目索引，也就不会出现与平台不一致的第二份可见性规则。
 */
export function callerProjectResolver(client: ApiClient, caller: McpCaller): () => Promise<CallerProject> {
  let pending: Promise<CallerProject> | undefined;
  return () => (pending ??= resolve(client, caller));
}

async function resolve(client: ApiClient, caller: McpCaller): Promise<CallerProject> {
  const page = await client.projects.list();
  const hit = page.items.find((project) => project.slug === caller.project);
  if (!hit) throw notFound('调用方对应的项目', caller.project);
  if (!hit.serviceId) throw precondition(`项目 ${hit.slug} 尚未完成开通，还没有服务`, { state: hit.state });
  return { projectId: hit.id, serviceId: hit.serviceId, slug: hit.slug };
}
