import type { ProjectId, RepositoryBindingDto, ServiceId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';

export type RepositoryBindingState = RepositoryBindingDto['state'];

/** 一个逻辑服务与一个远端仓库的绑定（R32）；远端仓库一旦被某服务绑定就不能被别的服务接管。 */
export interface RepositoryBinding {
  readonly serviceId: ServiceId;
  readonly projectId: ProjectId;
  readonly provider: 'gitlab';
  readonly remoteProjectId: string;
  readonly pathWithNamespace: string;
  readonly httpUrl: string;
  readonly defaultBranch: string;
  readonly state: RepositoryBindingState;
  readonly message?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** 仓库路径固定为 `<平台组>/<项目 slug>`：名字可预测，冲突可被提前发现。 */
export function repositoryPath(groupPath: string, slug: string): string {
  return `${groupPath.replace(/^\/+|\/+$/g, '')}/${slug}`;
}

/** 仓库 HTTP 地址由平台配置的 GitLab 地址推出，而不是信任 GitLab 自报的 external_url（集群内外地址可能不同）。 */
export function repositoryHttpUrl(baseUrl: string, pathWithNamespace: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${pathWithNamespace}.git`;
}

export interface NewBindingInput {
  readonly serviceId: ServiceId;
  readonly projectId: ProjectId;
  readonly remoteProjectId: string;
  readonly pathWithNamespace: string;
  readonly httpUrl: string;
  readonly defaultBranch: string;
  readonly now: Date;
}

export function newBinding(input: NewBindingInput): RepositoryBinding {
  const { now, ...fields } = input;
  return { ...fields, provider: 'gitlab', state: 'creating', createdAt: now, updatedAt: now };
}

const TRANSITIONS: Record<RepositoryBindingState, readonly RepositoryBindingState[]> = {
  creating: ['ready', 'failed'],
  ready: [],
  failed: ['creating'],
};

/** 迁移时清掉上一次的失败消息，除非本次给出新消息。 */
export function transition(binding: RepositoryBinding, next: RepositoryBindingState, now: Date, message?: string): RepositoryBinding {
  if (!TRANSITIONS[binding.state].includes(next)) {
    throw precondition(`仓库绑定 ${binding.pathWithNamespace} 不能从 ${binding.state} 进入 ${next}`, { from: binding.state, to: next });
  }
  const { message: _previous, ...rest } = binding;
  return { ...rest, state: next, updatedAt: now, ...(message === undefined ? {} : { message }) };
}
