import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { jsonHash } from '../../../packages/kernel';
import { GitLabActivityRequestSchema, GitLabConsumerManifestSchema, GitLabConsumerGroupSchema } from '../../../packages/gitlab-client';
import type { GitLabActivityObserver } from '../../../packages/gitlab-client';
import { originalDockerGitlabObserver } from './observer';
import { nativeSourceCommand } from './process';
import type { GitLabNativeCommand } from './process';

/** Original Rails/Redis and all visible Linux threads; no service restart or process signalling. */
export function originalDockerGitlabActivityObserver(options: {
  containerId: string; image: string; startedAt: string; command?: GitLabNativeCommand;
}): GitLabActivityObserver {
  const inspect = originalDockerGitlabObserver(options).inspect, containerId = options.containerId, command = options.command ?? nativeSourceCommand;
  const source = ['native/reader.rb', 'native/activity/consumers.rb', 'native/activity/runner.rb']
    .map(path => readFileSync(join(import.meta.dir, '../../../packages/gitlab-client', path)).toString()).join('\n');
  const encoded = Buffer.from(source).toString('base64');
  const consumerSource = ['native/activity/consumers.rb', 'native/activity/manifest.rb']
    .map(path => readFileSync(join(import.meta.dir, '../../../packages/gitlab-client', path)).toString()).join('\n');
  const consumerEncoded = Buffer.from(consumerSource).toString('base64');
  const consumersCommand = async (input: unknown, uid: string, signal: AbortSignal) => {
    const output = await command(['docker', 'exec', '-i', '--user', uid, '-e', 'CS_GITLAB_CONSUMERS_READ=1', containerId,
      '/opt/gitlab/embedded/bin/ruby', '-rbase64', '-e', 'eval(Base64.strict_decode64(' + JSON.stringify(consumerEncoded) + '), TOPLEVEL_BINDING, "crewstation-native-consumers.rb")'], signal, JSON.stringify(input));
    if (!output.trim().startsWith('CS_GITLAB_CONSUMERS=') || output.trim().split('\n').length !== 1 || Buffer.byteLength(output) > 8_388_608) throw Error('native-source-activity-consumers-unavailable');
    return JSON.parse(output.trim().slice('CS_GITLAB_CONSUMERS='.length));
  };
  return { inspect, read: async (raw, signal) => {
    const request = GitLabActivityRequestSchema.parse(raw);
    if (Buffer.byteLength(JSON.stringify(request)) > 8_388_608) throw Error('native-source-activity-request-budget');
    const manifest = GitLabConsumerManifestSchema.parse(await consumersCommand({ mode: 'manifest' }, '0', signal));
    if (manifest.source.bootId !== request.original.runtime.bootId || manifest.source.namespace !== request.original.runtime.namespace) throw Error('native-source-activity-consumers-source-changed');
    const references = [];
    for (const uid of [...new Set(manifest.processes.map(row => row.uid))].sort()) {
      const group = GitLabConsumerGroupSchema.parse(await consumersCommand({ mode: 'consume', original: manifest, identities: request.identities }, uid, signal));
      if (group.uid !== uid || group.originalRevision !== manifest.revision || jsonHash(group.source) !== jsonHash(manifest.source)
        || group.identitiesDigest !== jsonHash(request.identities) || group.consumers.some(row => !manifest.processes.some(pid => pid.pid === row.pid && pid.uid === uid && pid.startedTick === row.startedTick))) throw Error('native-source-activity-consumers-group-changed');
      references.push(...group.consumers);
    }
    const after = GitLabConsumerManifestSchema.parse(await consumersCommand({ mode: 'manifest' }, '0', signal));
    if (jsonHash(manifest) !== jsonHash(after)) throw Error('native-source-activity-process-set-changed');
    const input = JSON.stringify({ ...request, consumerReport: { source: manifest.source, identitiesDigest: jsonHash(request.identities), consumers: references } });
    return command(['docker', 'exec', '-i', '-e', 'CS_GITLAB_NATIVE_READ=0', '-e', 'CS_GITLAB_ACTIVITY_READ=1', containerId,
      '/opt/gitlab/bin/gitlab-rails', 'runner', 'require "base64"; eval(Base64.strict_decode64(' + JSON.stringify(encoded) + '), TOPLEVEL_BINDING, "crewstation-native-activity.rb")'], signal, input);
  } };
}
