import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { GitLabNativeInstanceSchema, GitLabStorageRootsSchema } from '../../../packages/gitlab-client';
import { originalDockerGitlabObserver } from './observer';
import { originalDockerGitlabFootprintObserver } from './footprint';
import { originalDockerGitlabActivityObserver } from './activity';
import { originalDockerGitlabFenceObserver } from './fence';
import { originalDockerGitlabDestructionObserver } from './destruction';
import { originalDockerGitlabStorageRemovalObserver } from './removal';
import { nativeGitlabService } from './service';
import { nativeDeletionGrantClient } from './grantClient';
import { jsonHash } from '../../../packages/kernel';

// The deployer supplies a secret file, never user-controlled request commands.
const path = Bun.argv[2]; if (!path) throw Error('native-source-config-file-required');
const config = z.strictObject({ instance: GitLabNativeInstanceSchema, roots: GitLabStorageRootsSchema,
  actorId: z.string().regex(/^[1-9][0-9]*$/), token: z.string().min(32), grantUrl: z.string().url(), grantToken: z.string().min(32),
  hostname: z.enum(['127.0.0.1', '0.0.0.0']), port: z.number().int().min(1024).max(65535),
}).parse(JSON.parse(readFileSync(path, 'utf8')));
const original = { containerId: config.instance.id, image: config.instance.image, startedAt: config.instance.startedAt };
const native = originalDockerGitlabObserver(original);
if (jsonHash(await native.inspect(AbortSignal.timeout(10_000))) !== jsonHash(config.instance)) throw Error('native-source-configured-installation-changed');
const fetchHandler = nativeGitlabService({ ...config,
  native, footprint: originalDockerGitlabFootprintObserver({ ...original, roots: config.roots }),
  activity: originalDockerGitlabActivityObserver(original), fence: originalDockerGitlabFenceObserver({ ...original, actorId: config.actorId }),
  destruction: originalDockerGitlabDestructionObserver({ ...original, actorId: config.actorId }),
  removal: originalDockerGitlabStorageRemovalObserver({ ...original, roots: config.roots }),
  assertGrant: nativeDeletionGrantClient({ url: config.grantUrl, token: config.grantToken }),
});
const server = Bun.serve({ hostname: config.hostname, port: config.port, idleTimeout: 120, fetch: fetchHandler });
process.on('SIGTERM', () => { void server.stop(true); });
process.on('SIGINT', () => { void server.stop(true); });
