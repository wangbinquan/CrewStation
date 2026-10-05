import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GitLabDestructionRequestSchema } from '../../../packages/gitlab-client';
import type { GitLabDestructionObserver } from '../../../packages/gitlab-client';
import { originalDockerGitlabObserver } from './observer';
import { nativeSourceCommand } from './process';
import type { GitLabNativeCommand } from './process';

/** Fixed native source and service actor; no caller commands or path lookup after parent deletion. */
export function originalDockerGitlabDestructionObserver(options: {
  containerId: string; image: string; startedAt: string; actorId: string; command?: GitLabNativeCommand;
}): GitLabDestructionObserver {
  if (!/^[1-9][0-9]*$/.test(options.actorId) || !Number.isSafeInteger(Number(options.actorId))) throw Error('native-source-destruction-actor-required');
  const inspect = originalDockerGitlabObserver(options).inspect, command = options.command ?? nativeSourceCommand;
  const actorId = options.actorId, containerId = options.containerId;
  const source = ['native/reader.rb', 'native/fence/runner.rb', 'native/destruction/remaining.rb', 'native/destruction/runner.rb']
    .map(path => readFileSync(join(import.meta.dir, '../../../packages/gitlab-client', path)).toString()).join('\n');
  const encodedSource = Buffer.from(source).toString('base64');
  return { inspect, run: (raw, signal) => {
    const request = GitLabDestructionRequestSchema.parse(raw), input = JSON.stringify({ request, actorId });
    if (Buffer.byteLength(input) > 8_388_608) throw Error('native-source-destruction-request-budget');
    return command(['docker', 'exec', '-i', '-e', 'CS_GITLAB_NATIVE_DESTRUCTION=1', containerId, '/opt/gitlab/bin/gitlab-rails', 'runner',
      'require "base64"; eval(Base64.strict_decode64(' + JSON.stringify(encodedSource) + '), TOPLEVEL_BINDING, "crewstation-native-destruction.rb")'], signal, input);
  } };
}
