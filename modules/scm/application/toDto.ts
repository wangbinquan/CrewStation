import type { RepositoryBindingDto, TagDto } from '@crewstation/contracts';
import type { RepositoryBinding } from '../domain/repositoryBinding';
import type { RemoteTag } from '../ports/gitLabGateway';

export function bindingToDto(binding: RepositoryBinding): RepositoryBindingDto {
  return {
    serviceId: binding.serviceId,
    provider: binding.provider,
    remoteProjectId: binding.remoteProjectId,
    pathWithNamespace: binding.pathWithNamespace,
    httpUrl: binding.httpUrl,
    defaultBranch: binding.defaultBranch,
    state: binding.state,
    ...(binding.message ? { message: binding.message } : {}),
    createdAt: binding.createdAt.toISOString(),
  };
}

export function tagToDto(tag: RemoteTag): TagDto {
  return { name: tag.name, commitSha: tag.commitSha, createdAt: tag.createdAt, protected: tag.protected };
}
