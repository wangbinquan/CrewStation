import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GitLabStorageRequestSchema, GitLabStorageRootsSchema } from '../../../packages/gitlab-client';
import type { GitLabStorageObserver, GitLabStorageRoots } from '../../../packages/gitlab-client';
import { originalDockerGitlabObserver } from './observer';
import { nativeSourceCommand } from './process';
import type { GitLabNativeCommand } from './process';

/** Host configuration binds captured roots; HTTP callers cannot supply root paths. */
export function originalDockerGitlabStorageObserver(options: {
  containerId: string; image: string; startedAt: string; roots: GitLabStorageRoots; command?: GitLabNativeCommand;
}): GitLabStorageObserver {
  const roots = GitLabStorageRootsSchema.parse(options.roots), inspect = originalDockerGitlabObserver(options).inspect;
  const containerId = options.containerId, command = options.command ?? nativeSourceCommand;
  const source = readFileSync(join(import.meta.dir, '../../../packages/gitlab-client/native/storage/reader.rb')).toString('base64');
  return { inspect, read: (raw, signal) => {
    const request = GitLabStorageRequestSchema.parse(raw);
    if (Buffer.byteLength(JSON.stringify(request)) > 32_768) throw Error('native-source-storage-request-budget');
    const input = JSON.stringify({ roots, request });
    if (Buffer.byteLength(input) > 65_536) throw Error('native-source-storage-config-budget');
    return command(['docker', 'exec', '-i', '-e', 'CS_GITLAB_STORAGE_READ=1', containerId, '/opt/gitlab/embedded/bin/ruby', '-rbase64', '-e',
      'eval(Base64.strict_decode64(' + JSON.stringify(source) + '), TOPLEVEL_BINDING, "crewstation-storage-reader.rb")'], signal, input);
  } };
}
