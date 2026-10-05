import { createGitLabClient, createGitLabNativeClient, createGitLabFootprintClient, createGitLabActivityClient,
  createGitLabFenceClient, createGitLabDestructionClient, createGitLabStorageRemovalClient } from '@crewstation/gitlab-client';
import type { GitLabNativeInstance } from '@crewstation/gitlab-client';
import type { ProjectDeletionContext } from '@crewstation/contracts';
import { nativeScopeTransport } from './nativeScopeTransport';

/** Actual SDK/host composition; retained materials cross the private boundary
 * only during the controller's current stop or purge operation. */
export function nativeScmDeletionSources(input: { baseUrl: string; token: string; instance: GitLabNativeInstance;
  gitlabUrl: string; gitlabToken: string; assertGrant(context: ProjectDeletionContext): Promise<void>; fetch?: typeof fetch;
}) {
  const transport = nativeScopeTransport(input.fetch), options = { ...input, fetch: transport.fetch };
  const native = createGitLabNativeClient(options);
  return { sources: { ...input, native, files: createGitLabFootprintClient(options), activity: createGitLabActivityClient(options),
    fence: createGitLabFenceClient(options), destruction: createGitLabDestructionClient(options), removal: createGitLabStorageRemovalClient(options) },
    rest: createGitLabClient({ baseUrl: input.gitlabUrl, token: input.gitlabToken, ...(input.fetch ? { fetch: input.fetch } : {}) }),
    run: transport.run };
}
