import { Database } from 'bun:sqlite';
import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BotContextStorage, TaskId } from '@crewstation/contracts';
import type { ProcessLauncher } from '../process/launcher';
import { prepareBotNativeData, verifyNativeSession } from './nativeData';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function directory() { const root = await mkdtemp(join(tmpdir(), 'cs-bot-native-')); roots.push(root); return root; }
const storage: BotContextStorage = { version: 1, ownerTaskId: '01a0bf5d-8f4b-7001-8458-107366e7de39' as TaskId, conversationId: '01a0bf5d-8f4b-7001-8458-107366e7de40', epoch: 1, volumeUid: 'original', pvcName: 'bot-01a0bf5d8f4b70018458107366e7de39', mode: 'create' };
test('native database and artifacts survive a new HOME while credentials remain ephemeral', async () => {
  const root = await directory(), first = await directory(), second = await directory();
  const launcher = { chownToWorker: async () => {} } as unknown as ProcessLauncher;
  const env = await prepareBotNativeData({ root, scratch: join(first, 'scratch'), home: first, storage, protocol: 'opencode', launcher });
  await writeFile(join(env.XDG_DATA_HOME!, 'opencode/auth.json'), 'temporary-provider-credential');
  await mkdir(join(first, '.config')); await writeFile(join(first, '.config/settings.json'), 'temporary-config');
  const db = new Database(env.OPENCODE_DB!); db.exec('CREATE TABLE session(id TEXT PRIMARY KEY)'); db.query('INSERT INTO session VALUES (?)').run('ses_original'); db.close();
  await writeFile(join(root, 'tool-output/result'), 'tool result'); await rm(first, { recursive: true });
  const resumed = await prepareBotNativeData({ root, scratch: join(second, 'scratch'), home: second, storage: { ...storage, mode: 'existing' }, protocol: 'opencode', sessionId: 'ses_original', launcher });
  expect(resumed.OPENCODE_DB).toBe(env.OPENCODE_DB); expect(resumed.HOME).toBe(second);
  expect(await readlink(join(resumed.XDG_DATA_HOME!, 'opencode/tool-output'))).toBe(join(root, 'tool-output'));
  expect(await readFile(join(resumed.XDG_DATA_HOME!, 'opencode/tool-output/result'), 'utf8')).toBe('tool result');
  await expect(readFile(join(root, 'auth.json'))).rejects.toThrow();
  await expect(readFile(join(resumed.XDG_DATA_HOME!, 'opencode/auth.json'))).rejects.toThrow();
  expect(() => verifyNativeSession(env.OPENCODE_DB!, 'ses_missing')).toThrow('已丢失');
  await expect(prepareBotNativeData({ root, home: second, storage, protocol: 'claude-code', launcher })).rejects.toThrow('尚未验证');
});
test('missing or corrupt native database never creates a new session database', async () => {
  const root = await directory(), path = join(root, 'missing.db');
  expect(() => verifyNativeSession(path, 'ses_original')).toThrow('不可读');
  await expect(readFile(path)).rejects.toThrow();
  await writeFile(path, 'corrupt'); expect(() => verifyNativeSession(path, 'ses_original')).toThrow('不可读');
  expect(await readFile(path, 'utf8')).toBe('corrupt');
});

test('native recovery rejects a database symlink instead of following a foreign session', async () => {
  const root = await directory(), foreign = join(root, 'foreign.db'), link = join(root, 'opencode.db');
  const db = new Database(foreign); db.exec("CREATE TABLE session(id TEXT PRIMARY KEY); INSERT INTO session VALUES ('ses_foreign')"); db.close();
  await symlink(foreign, link);
  expect(() => verifyNativeSession(link, 'ses_foreign')).toThrow('路径不安全');
});
