import { open } from 'node:fs/promises';

/** pg_dump owns a single consistent database snapshot. The DSN stays out of argv and diagnostics. */
export async function dumpObjectBackupDatabase(input: { databaseUrl: string; path: string; signal: AbortSignal; binary?: string }) {
  const output = await open(input.path, 'wx', 0o600);
  try {
    const proc = Bun.spawn([input.binary ?? 'pg_dump', '--format=custom', '--no-owner', '--no-privileges'], {
      env: { ...process.env, PGDATABASE: input.databaseUrl, PGCONNECT_TIMEOUT: '10' }, stdout: output.fd, stderr: 'ignore', stdin: 'ignore', signal: input.signal,
    });
    if (await proc.exited) throw new Error('PostgreSQL snapshot failed; check server/client version and operator credentials');
    await output.sync();
  } finally { await output.close(); }
}
