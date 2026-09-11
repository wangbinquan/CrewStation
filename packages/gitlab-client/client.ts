import { accessTokenOperations } from './accessTokens';
import { projectOperations } from './projects';
import { protectedTagOperations } from './protectedTags';
import { repositoryOperations } from './repository';
import type { TransportOptions } from './transport';
import { createTransport } from './transport';
import { webhookOperations } from './webhooks';

export type GitLabClientOptions = TransportOptions;

export type GitLabClient =
  ReturnType<typeof projectOperations> & ReturnType<typeof repositoryOperations> & ReturnType<typeof protectedTagOperations> &
  ReturnType<typeof accessTokenOperations> & ReturnType<typeof webhookOperations>;

/** 基于 fetch 的 GitLab REST v4 客户端；`fetch` 可注入以便测试。 */
export function createGitLabClient(options: GitLabClientOptions): GitLabClient {
  const transport = createTransport(options);
  return {
    ...projectOperations(transport),
    ...repositoryOperations(transport),
    ...protectedTagOperations(transport),
    ...accessTokenOperations(transport),
    ...webhookOperations(transport),
  };
}
