/** Explicit restore into an isolated database. Secrets are read only from a private file and never printed. */
import { lstat, readFile } from 'node:fs/promises';
import { connectDatabase } from '../../../packages/persistence';
import { createObjectBackupTools } from '../../../modules/data';
import { createObjectStoragePlane } from '../../../modules/data-control';

const [directory, manifestDigest, requestKey, targetFile] = process.argv.slice(2);
if (!directory || !manifestDigest || !requestKey || !targetFile) throw new Error('Usage: restore.ts <backup-directory> <manifest-sha256> <request-key> <private-destinations.json>');
const file = await lstat(targetFile);
if (!file.isFile() || file.size > 256 * 1024 || (file.mode & 0o077) !== 0) throw new Error('Destination credentials require a regular private file (0600) under 256 KiB');
const databaseUrl = process.env.CS_DATABASE_URL, secretKey = process.env.CS_SECRET_KEY;
if (!databaseUrl || !secretKey) throw new Error('Provide the isolated target CS_DATABASE_URL and CS_SECRET_KEY through the operator environment');
const connection = connectDatabase(databaseUrl), stop = new AbortController();
process.once('SIGTERM', () => stop.abort()); process.once('SIGINT', () => stop.abort());
try {
  const tools = createObjectBackupTools(connection.db, createObjectStoragePlane(connection.db, secretKey));
  const bundle = await tools.readBundle(directory, manifestDigest, stop.signal);
  if (!tools.restore) throw new Error('Restore plane unavailable');
  await tools.restore({ requestKey, manifestDigest, bundle, destinations: JSON.parse(await readFile(targetFile, 'utf8')) }, stop.signal);
  console.log(JSON.stringify({ backupId: bundle.manifest.backupId, state: 'objects-restored', notice: 'Task volumes and external application databases are not restored; reconcile them before starting platform controllers.' }));
} finally { await connection.close(); }
