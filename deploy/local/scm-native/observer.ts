import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GitLabNativeInstanceSchema, GitLabNativeRequestSchema } from '../../../packages/gitlab-client';
import type { GitLabNativeObserver, GitLabNativeRequest } from '../../../packages/gitlab-client';
import { jsonHash } from '../../../packages/kernel';
import { nativeSourceCommand } from './process';
import type { GitLabNativeCommand } from './process';

/** Host-side read adapter. No Docker socket is exposed to a platform container. */
export function originalDockerGitlabObserver(options: { containerId: string; image: string; startedAt: string; command?: GitLabNativeCommand }): GitLabNativeObserver {
  if (!/^[a-f0-9]{64}$/.test(options.containerId) || !/^sha256:[a-f0-9]{64}$/.test(options.image) || !Number.isFinite(Date.parse(options.startedAt))) throw Error('native-source-original-instance-required');
  const original = { containerId: options.containerId, image: options.image, startedAt: options.startedAt }, command = options.command ?? nativeSourceCommand;
  const source = readFileSync(join(import.meta.dir, '../../../packages/gitlab-client/native/reader.rb')).toString('base64');
  return {
    inspect: async signal => {
      const raw = await command(['docker', 'inspect', '--format', '{{json .Id}} {{json .Image}} {{json .State.StartedAt}} {{json .State.Running}}', original.containerId], signal);
      const match = raw.trim().match(/^"([a-f0-9]{64})" "(sha256:[a-f0-9]{64})" "([^"]+)" true$/);
      if (!match || match[1] !== original.containerId || match[2] !== original.image || match[3] !== original.startedAt) throw Error('native-source-original-instance-changed');
      const runtime = JSON.parse(await command(['docker', 'exec', original.containerId, '/opt/gitlab/embedded/bin/ruby', '-rjson', '-e',
        'puts JSON.generate({bootId:File.read("/proc/sys/kernel/random/boot_id").strip,namespace:File.readlink("/proc/self/ns/pid")})'], signal)) as { bootId: string; namespace: string };
      if (!/^[a-f0-9-]{36}$/.test(runtime.bootId) || !/^pid:\[[1-9][0-9]*\]$/.test(runtime.namespace)) throw Error('native-source-original-namespace-unavailable');
      return GitLabNativeInstanceSchema.parse({ id: original.containerId, image: original.image, startedAt: original.startedAt, epoch: jsonHash(runtime) });
    },
    read: (request: GitLabNativeRequest, signal) => {
      const encoded = JSON.stringify(GitLabNativeRequestSchema.parse(request));
      if (Buffer.byteLength(encoded) > 32_768) throw Error('native-source-request-budget');
      return command(['docker', 'exec', '-i', '-e', 'CS_GITLAB_NATIVE_READ=1', original.containerId,
        '/opt/gitlab/bin/gitlab-rails', 'runner', 'require "base64"; eval(Base64.strict_decode64(' + JSON.stringify(source) + '), TOPLEVEL_BINDING, "crewstation-native-reader.rb")'], signal, encoded);
    },
  };
}
