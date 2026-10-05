import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GitLabFenceRequestSchema } from '../../../packages/gitlab-client';
import type { GitLabFenceObserver } from '../../../packages/gitlab-client';
import { originalDockerGitlabObserver } from './observer';
import { nativeSourceCommand } from './process';
import type { GitLabNativeCommand } from './process';

/** Native mutations use only the configured original service actor and fixed source, never caller Ruby/commands. */
export function originalDockerGitlabFenceObserver(options: {
  containerId: string; image: string; startedAt: string; actorId: string; command?: GitLabNativeCommand;
}): GitLabFenceObserver {
  if (!/^[1-9][0-9]*$/.test(options.actorId) || !Number.isSafeInteger(Number(options.actorId))) throw Error('native-source-fence-actor-required');
  const inspect = originalDockerGitlabObserver(options).inspect, command = options.command ?? nativeSourceCommand;
  const actorId = options.actorId, containerId = options.containerId;
  const source = ['native/reader.rb', 'native/fence/runner.rb'].map(path => readFileSync(join(import.meta.dir, '../../../packages/gitlab-client', path)).toString()).join('\n');
  const encodedSource = Buffer.from(source).toString('base64');
  return { inspect, fence: (raw, signal) => {
    const request = GitLabFenceRequestSchema.parse(raw), input = JSON.stringify({ request, actorId });
    if (Buffer.byteLength(input) > 8_388_608) throw Error('native-source-fence-request-budget');
    return command(['docker', 'exec', '-i', '-e', 'CS_GITLAB_NATIVE_FENCE=1', containerId, '/opt/gitlab/bin/gitlab-rails', 'runner',
      'require "base64"; eval(Base64.strict_decode64(' + JSON.stringify(encodedSource) + '), TOPLEVEL_BINDING, "crewstation-native-fence.rb")'], signal, input);
  } };
}
