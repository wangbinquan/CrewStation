import type { ApiClient } from '@crewstation/api-client';
import { isApiClientError } from '@crewstation/api-client';
import type { ProjectDto } from '@crewstation/contracts';
import { CliFailure } from '../runtime/cliError';

const PROJECT_ID = /^prj_[0-9a-f]{32}$/;

/**
 * 命令行上人写的是 slug（`crewstation publish demo`），平台路由收的是 ID。
 * 形状像 ID 的直接取；否则在“我可见的项目”里按 slug 找，找不到就把可选项报出来。
 */
export async function resolveProject(api: ApiClient, ref: string): Promise<ProjectDto> {
  if (PROJECT_ID.test(ref)) return api.projects.get(ref);
  const page = await api.projects.list();
  const hit = page.items.find((project) => project.slug === ref);
  if (hit !== undefined) return hit;
  const known = page.items.map((project) => project.slug).sort();
  throw new CliFailure(`没有可见的项目 ${ref}`, known.length === 0 ? ['  当前身份看不到任何项目'] : ['  可见项目：' + known.join('、')]);
}

/** 有服务才谈得上分支、发布与切流；开通未完成时说清楚是哪一步卡住。 */
export function requireServiceId(project: ProjectDto): string {
  if (project.serviceId !== undefined) return project.serviceId;
  const reason = project.message === undefined ? '' : `：${project.message}`;
  throw new CliFailure(`项目 ${project.slug} 还没有服务（state=${project.state}）${reason}`, ['  等开通完成，或让管理员查看项目开通链']);
}

/** 开发会话可能不存在；404 在这里转成 undefined，命令自己决定怎么说。 */
export async function findDevSession(api: ApiClient, projectId: string): Promise<Awaited<ReturnType<ApiClient['devSession']['get']>> | undefined> {
  try {
    return await api.devSession.get(projectId);
  } catch (error) {
    if (isApiClientError(error) && error.kind === 'not_found') return undefined;
    throw error;
  }
}
