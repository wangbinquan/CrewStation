import { SlugSchema } from '@crewstation/contracts';
import type { Actor, ProjectDomainPreview } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';
import { RESERVED_SLUGS } from '../../domain/project';
import type { ProjectUseCaseDeps } from '../dependencies';
import { developerActor } from './eligibility';

/** 不声明或预占任何资源；与服务 DTO 共用安装时注入的 HostNaming。 */
export function projectDomainPreviewUseCase(deps: Pick<ProjectUseCaseDeps, 'users' | 'hosts'>) {
  return async (actor: Actor, slug: string): Promise<ProjectDomainPreview> => {
    await developerActor(deps, actor);
    if (!SlugSchema.safeParse(slug).success || RESERVED_SLUGS.includes(slug)) throw validation('请使用有效且非平台保留名的域名标识', { field: 'slug' });
    return { slug, prodHost: deps.hosts.prodHost(slug), previewHost: deps.hosts.previewHost(slug), serviceHost: deps.hosts.serviceHost(slug) };
  };
}
