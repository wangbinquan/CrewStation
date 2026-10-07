// Acceptance-only: actual WAL/journal/Session PG/ledger, controlled source values. No model invocation or supplier bill.
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TestDatabase } from '../../../packages/testkit';
import { DevelopmentNativeObserver } from '../../../packages/agent-drivers/drivers/usage/developmentNativeObserver';
import type { DevelopmentUsageJournal } from '../../../runtimes/task/src/agents/developmentUsageJournal';
import { drizzleDevelopmentUsageStore } from '../../../modules/session/adapters/persistence/developmentUsage';
import { drizzleDevelopmentUsageSourceStore } from '../../../modules/session/adapters/persistence/developmentUsageSources';
import type { DevelopmentUsageRegistration } from '../../../packages/contracts';
import { nativeNumericExecution } from './nativeNumericExecution';
export const numericModel = { provider: 'acceptance-native-provider', model: 'acceptance-native-model', condition: null };
export async function nativeNumericFixture(database: TestDatabase) {
  const directory = await mkdtemp(join(tmpdir(), 'cs-native-numeric-')), path = join(directory, 'actual-native.db');
  const db = new Database(path), root = 'actual-root-' + crypto.randomUUID(), podUid = 'actual-fixture-pod-' + crypto.randomUUID();
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE session(id TEXT PRIMARY KEY,parent_id TEXT,time_created INTEGER); CREATE INDEX session_parent ON session(parent_id,id);
    CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,data TEXT);
    CREATE TABLE part(id TEXT PRIMARY KEY,session_id TEXT,message_id TEXT,time_created INTEGER,data TEXT);
    CREATE INDEX part_session ON part(session_id,id);`);
  const observer = new DevelopmentNativeObserver(path), sessions: string[] = [], journals: DevelopmentUsageJournal[] = [];
  const usage = drizzleDevelopmentUsageStore(database.db), sources = drizzleDevelopmentUsageSourceStore(database.db);
  const populate = (count: number, depth: number, knownBirth = true) => db.transaction(() => {
    for (let n = 0; n <= depth; n++) {
      const id = n === 0 ? root : root + ':child:' + n; sessions.push(id);
      db.query('INSERT INTO session VALUES(?,?,?)').run(id, n === 0 ? null : sessions[n - 1]!, knownBirth ? Date.now() : null);
    }
    for (let n = 0; n < count; n++) addStep('actual-step-' + String(n).padStart(6, '0'), n + 1, sessions.at(-1)!);
  })();
  function addStep(id: string, input: number, session = root, unknownOutput = false) {
    db.query('INSERT INTO message VALUES(?,?,?)').run(id, session, JSON.stringify({ role: 'assistant', providerID: numericModel.provider, modelID: numericModel.model }));
    db.query('INSERT INTO part VALUES(?,?,?,?,?)').run(id, session, id, Date.now(), JSON.stringify({ type: 'step-finish',
      tokens: { input, ...(unknownOutput ? {} : { output: 2, reasoning: 1 }), cache: { read: 3, write: 5 } } }));
  }
  const execution = (resume: boolean, original?: { identity: Pick<DevelopmentUsageRegistration['identity'], 'projectId' | 'taskId'> }) => nativeNumericExecution({
    database, directory, path, root, podUid, journals, observer, usage, sources,
  }, resume, original);
  return { directory, path, db, root, sessions, populate, addStep, execution, sources,
    close: async () => { for (const journal of journals) journal.close(); db.close(); await rm(directory, { recursive: true, force: true }); } };
}
