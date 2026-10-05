import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GitLabFootprintRequestSchema, GitLabStorageRootsSchema } from '../../../packages/gitlab-client';
import type { GitLabFootprintObserver, GitLabStorageRoots } from '../../../packages/gitlab-client';
import { originalDockerGitlabObserver } from './observer';
import { nativeSourceCommand } from './process';
import type { GitLabNativeCommand } from './process';

/** Only the captured installation roots and fixed source are passed to Ruby. */
export function originalDockerGitlabFootprintObserver(options: {
  containerId: string; image: string; startedAt: string; roots: GitLabStorageRoots; command?: GitLabNativeCommand;
}): GitLabFootprintObserver {
  const roots = GitLabStorageRootsSchema.parse(options.roots), inspect = originalDockerGitlabObserver(options).inspect;
  const containerId = options.containerId, command = options.command ?? nativeSourceCommand;
  const source = ['reader.rb', 'locator.rb'].map(path => readFileSync(join(import.meta.dir, '../../../packages/gitlab-client/native/storage', path)).toString()).join('\n');
  const encoded = Buffer.from(source).toString('base64');
  return { inspect, read: (raw, signal) => {
    const request = GitLabFootprintRequestSchema.parse(raw), input = JSON.stringify({ roots, ...request });
    if (JSON.stringify(roots) !== JSON.stringify(request.original.roots)) throw Error('native-source-footprint-roots-changed');
    if (Buffer.byteLength(input) > 8_388_608) throw Error('native-source-footprint-request-budget');
    return command(['docker', 'exec', '-i', '-e', 'CS_GITLAB_STORAGE_READ=0', '-e', 'CS_GITLAB_FOOTPRINT_READ=1', containerId,
      '/opt/gitlab/embedded/bin/ruby', '-rbase64', '-e', 'eval(Base64.strict_decode64(' + JSON.stringify(encoded) + '), TOPLEVEL_BINDING, "crewstation-footprint.rb")'], signal, input);
  } };
}
