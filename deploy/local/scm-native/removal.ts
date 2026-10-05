import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GitLabStorageRemovalRequestSchema, GitLabStorageRootsSchema } from '../../../packages/gitlab-client';
import type { GitLabStorageRemovalObserver, GitLabStorageRoots } from '../../../packages/gitlab-client';
import { jsonHash } from '../../../packages/kernel';
import { originalDockerGitlabObserver } from './observer';
import { nativeSourceCommand } from './process';
import type { GitLabNativeCommand } from './process';

export function originalDockerGitlabStorageRemovalObserver(options: {
  containerId: string; image: string; startedAt: string; roots: GitLabStorageRoots; command?: GitLabNativeCommand;
}): GitLabStorageRemovalObserver {
  const roots = GitLabStorageRootsSchema.parse(options.roots), inspect = originalDockerGitlabObserver(options).inspect;
  const containerId = options.containerId, command = options.command ?? nativeSourceCommand;
  const source = ['native/storage/reader.rb', 'native/storage/remover.rb'].map(path => readFileSync(join(import.meta.dir, '../../../packages/gitlab-client', path)).toString()).join('\n');
  const encodedSource = Buffer.from(source).toString('base64');
  return { inspect, remove: (raw, signal) => {
    const request = GitLabStorageRemovalRequestSchema.parse(raw);
    if (jsonHash(request.original.roots) !== jsonHash(roots)) throw Error('native-source-removal-original-roots-changed');
    const input = JSON.stringify({ roots, original: request.original });
    if (Buffer.byteLength(input) > 8_388_608) throw Error('native-source-removal-request-budget');
    return command(['docker', 'exec', '-i', '-e', 'CS_GITLAB_STORAGE_REMOVE=1', containerId, '/opt/gitlab/embedded/bin/ruby', '-rbase64', '-e',
      'eval(Base64.strict_decode64(' + JSON.stringify(encodedSource) + '), TOPLEVEL_BINDING, "crewstation-storage-remover.rb")'], signal, input);
  } };
}
