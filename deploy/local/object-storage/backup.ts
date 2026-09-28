/** Trusted operator command. Requires explicit independent destination and a PostgreSQL 17+ pg_dump. */
import { connectDatabase } from '../../../packages/persistence';
import { createObjectBackupTools } from '../../../modules/data';
import { createObjectStoragePlane } from '../../../modules/data-control';
import { dumpObjectBackupDatabase } from './pgSnapshot';

const [action, argument, destination, reason] = process.argv.slice(2);
const databaseUrl = process.env.CS_DATABASE_URL, secretKey = process.env.CS_SECRET_KEY;
if (!databaseUrl || !secretKey) throw new Error('Provide CS_DATABASE_URL and CS_SECRET_KEY through the operator environment');
const connection = connectDatabase(databaseUrl), operations = createObjectBackupTools(connection.db, createObjectStoragePlane(connection.db, secretKey));
const signal = new AbortController();
process.on('SIGTERM', () => signal.abort()); process.on('SIGINT', () => signal.abort());
try {
  if (action === 'begin' && argument && destination && reason) {
    const result = await operations.begin({ requestKey: argument, destination, reason });
    console.log(JSON.stringify({ id: result.id, state: result.state }));
  } else if (action === 'status' && argument) {
    console.log(JSON.stringify(await operations.status(argument)));
  } else if (action === 'abort' && argument) {
    console.log(JSON.stringify(await operations.abort(argument)));
  } else if (action === 'export' && argument && destination) {
    const sink = await operations.fileBundle({ directory: destination, snapshot: (path, token) => dumpObjectBackupDatabase({ databaseUrl, path, signal: token, ...(process.env.CS_PG_DUMP ? { binary: process.env.CS_PG_DUMP } : {}) }) });
    const result = await operations.export(argument, sink, signal.signal);
    console.log(JSON.stringify({ id: result.id, state: result.state, objects: result.objectCount, bytes: result.bytes, manifestDigest: result.manifestDigest }));
  } else if (['verify', 'verify-restored'].includes(action ?? '') && argument && destination) {
    const bundle = await operations.readBundle(argument, destination, signal.signal); await bundle.verify();
    if (action === 'verify-restored') await operations.verifyRestore(bundle, destination, signal.signal);
    console.log(JSON.stringify({ backupId: bundle.manifest.backupId, objects: bundle.manifest.objectCount, bytes: bundle.manifest.bytes, state: action === 'verify-restored' ? 'restore-verified-writes-frozen' : 'bundle-verified' }));
  } else throw new Error('Usage: backup.ts begin <request-key> <destination-label> <reason> | status <id> | export <id> <new-absolute-directory> | abort <id> | verify <directory> <manifest-sha256> | verify-restored <directory> <manifest-sha256>');
} finally { await connection.close(); }
