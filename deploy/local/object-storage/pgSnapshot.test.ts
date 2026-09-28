import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dumpObjectBackupDatabase } from './pgSnapshot';

test('snapshot client receives credentials only through environment, writes privately and never overwrites a prior snapshot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cs-pgdump-contract-'));
  try {
    const binary = join(directory, 'pg-dump-test'), path = join(directory, 'snapshot'), databaseUrl = 'postgres://operator:test-secret@localhost/test';
    await writeFile(binary, '#!/bin/sh\n[ "$PGDATABASE" = "postgres://operator:test-secret@localhost/test" ] || exit 2\ncase "$*" in *test-secret*) exit 3;; esac\nprintf "verified-test-snapshot"\n', { mode: 0o700 });
    await dumpObjectBackupDatabase({ databaseUrl, path, binary, signal: new AbortController().signal });
    expect(await readFile(path, 'utf8')).toBe('verified-test-snapshot'); expect((await stat(path)).mode & 0o077).toBe(0);
    await expect(dumpObjectBackupDatabase({ databaseUrl, path, binary, signal: new AbortController().signal })).rejects.toThrow();
    await writeFile(binary, '#!/bin/sh\nexit 7\n', { mode: 0o700 });
    await expect(dumpObjectBackupDatabase({ databaseUrl, path: join(directory, 'failed'), binary, signal: new AbortController().signal })).rejects.toThrow('PostgreSQL snapshot failed');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
