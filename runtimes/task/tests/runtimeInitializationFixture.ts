import { chmod, chown, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RuntimeInitializationMaterialSchema } from '@crewstation/contracts';
import { newResourceId, noopLogger } from '@crewstation/kernel';
import { createProcessLauncher } from '../src/process/launcher';
import { probeCurrentUid, resolveIsolation } from '../src/process/privilege';
import { RuntimeInitialization, type RuntimeInitializationConfig } from '../src/initialization/runtimeInitialization';

export async function initializationFixture(script = 'printf x >> count', environment: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'cs-image-init-')), work = join(root, 'work');
  await chmod(root, 0o755); await mkdir(work);
  if (process.getuid?.() === 0) await chown(work, 10001, 10001);
  const launcher = createProcessLauncher({ isolation: resolveIsolation({ uid: 10001, gid: 10001, currentUid: probeCurrentUid(), which: (b) => Bun.which(b) }), processEnv: { ...process.env, ...environment }, workerHome: work, logger: noopLogger });
  const config: RuntimeInitializationConfig = { containerIdentity: 'pod/container-one', journalDir: join(root, 'journal'), material: RuntimeInitializationMaterialSchema.parse({ environmentId: newResourceId(), startGeneration: 1, versionId: newResourceId(), initializerDigest: `sha256:${'a'.repeat(64)}`, initializer: { steps: [{ id: 'setup', argv: ['/bin/sh', '-c', script], cwd: work, timeoutSeconds: 3 }], env: {}, secrets: [] }, tools: [], secrets: {} }) };
  const instances: RuntimeInitialization[] = [];
  return { root, work, launcher, config, make: (value = config) => { const result = new RuntimeInitialization(value, launcher); instances.push(result); return result; }, dispose: async () => { for (const instance of instances) await instance.close(); await rm(root, { recursive: true, force: true }); } };
}
