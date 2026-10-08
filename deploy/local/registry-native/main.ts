import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { createK8sClient, loadClusterConfig } from '../../../packages/k8s';
import { connectDatabase } from '../../../packages/persistence';
import { jsonHash } from '../../../packages/kernel';
import { nativeDeletionGrantClient } from '../scm-native/grantClient';
import { nativeRegistryAuthority } from './authority';
import { nativeRegistryJournal } from './journal';
import { nativeRegistryService } from './service';
import { RegistryNativeInstallationSchema, registryNativeSourceValidator } from './source';
import { RegistryProcessIdentitySchema } from './process/identity';
import { originalRegistryPause } from './process/pause';
import { runRegistryPauseGuardian, startRegistryPauseGuardian } from './process/guardian';
import { captureRegistryOperatorBirth, proveRegistryOperatorExit } from './process/operatorExit';
import { nativeRegistryNodeConsumers } from './nodeConsumers';

// Only the deployment's secret file supplies the installation, database and
// permit transport. The HTTP request cannot select a PID, path or command.
async function run() {
const path = Bun.argv[2]; if (!path) throw Error('native-registry-config-file-required');
const config = z.strictObject({ installation: RegistryNativeInstallationSchema, process: RegistryProcessIdentitySchema, journal: z.string().min(1), databaseUrl: z.string().url(),
  token: z.string().min(32), grantUrl: z.string().url(), grantToken: z.string().min(32), hostname: z.enum(['127.0.0.1', '0.0.0.0']), port: z.number().int().min(1024).max(65535),
}).parse(JSON.parse(readFileSync(path, 'utf8')));
if (config.process.containerId !== config.installation.origin.containerId || config.process.podUid !== config.installation.origin.podUid) throw Error('native-registry-original-process-configuration-changed');
const k8s = createK8sClient(loadClusterConfig()), db = connectDatabase(config.databaseUrl), processOwner = await originalRegistryPause(config.process, { guardian: startRegistryPauseGuardian });
const journal = nativeRegistryJournal(config.journal, jsonHash(config.installation.origin), { original: await captureRegistryOperatorBirth(), proveExit: proveRegistryOperatorExit }), assertGrant = nativeDeletionGrantClient({ url: config.grantUrl, token: config.grantToken });
await journal.recoverInterrupted();
const assertOriginalSource = registryNativeSourceValidator(k8s, config.installation);
const handler = nativeRegistryService({ token: config.token, root: config.installation.root, sourceIdentity: journal.sourceIdentity, journal, assertGrant, assertOriginalSource,
  fileConsumers: nativeRegistryNodeConsumers(k8s, config.installation, config.process),
  authority: (context, history, signal) => nativeRegistryAuthority({ db: db.db, process: processOwner, context, history, signal, assertGrant, assertOriginalSource }) });
const server = Bun.serve({ hostname: config.hostname, port: config.port, idleTimeout: 120, fetch: handler });
let closing = false;
const close = async () => { if (closing) return; closing = true; await server.stop(false); processOwner.close(); journal.close(); await db.close(); };
process.on('SIGTERM', () => { void close(); }); process.on('SIGINT', () => { void close(); });
}
if (Bun.argv[2] === '--registry-pause-guardian') await runRegistryPauseGuardian(); else await run();
