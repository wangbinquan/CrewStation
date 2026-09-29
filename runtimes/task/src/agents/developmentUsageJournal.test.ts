import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DevelopmentUsageAdmissionSchema, ProjectIdSchema, TaskIdSchema, type DevelopmentUsageAdmission, type RunnerUsageCapture } from '@crewstation/contracts';
import { DevelopmentUsageJournal, type DevelopmentJournalLimits } from './developmentUsageJournal';
import { developmentIntentDigest } from './developmentStartIntent';

const resource = (number: number) => `019f0000-0000-7000-8000-${String(number).padStart(12, '0')}`;
const context = { runtimeTaskId: TaskIdSchema.parse(resource(3)), workspaceTaskId: TaskIdSchema.parse(resource(2)), projectId: ProjectIdSchema.parse(resource(1)), podUid: 'physical-pod-a' };
const directories: string[] = [], journals: DevelopmentUsageJournal[] = [];
const at = '2026-09-30T00:00:00.000Z';
const capture: RunnerUsageCapture = { version: 1, measurements: [], diagnostics: ['not-measured'] };
const limits = { eventBytes: 4096, pageBytes: 8192, spoolBytes: 65536 };
async function directory() { const path = await mkdtemp(join(tmpdir(), 'cs-development-usage-')); directories.push(path); return path; }
function open(path: string, incarnation = randomUUID(), bounds: DevelopmentJournalLimits = limits, owner = context) { const journal = new DevelopmentUsageJournal(path, owner, incarnation, bounds); journals.push(journal); return journal; }
function admission(journal: DevelopmentUsageJournal): DevelopmentUsageAdmission {
  const intent = { version: 1 as const, identity: { sourceKind: 'development-agent' as const, projectId: context.projectId, taskId: context.workspaceTaskId, executionId: context.runtimeTaskId, executionGeneration: 1 as const, agentId: resource(4) },
    profileId: resource(5), profileRevision: 2, launch: { protocol: 'opencode' as const, binaryPath: '/usr/bin/opencode', extraArgs: [], isSandbox: false }, permission: 'full' as const, mode: 'interactive' as const,
    initialPrompt: 'private-owner-prompt', cwd: null, resumeSessionId: null, systemPrompt: null, mcp: [], nativeUsageLineageKey: `development:${context.workspaceTaskId}` };
  const base = { intent, digestNonce: 'a'.repeat(64) };
  return DevelopmentUsageAdmissionSchema.parse({ ...base, key: { executionId: context.runtimeTaskId, journalId: journal.journalId, incarnation: journal.incarnation, payloadDigest: developmentIntentDigest(base) } });
}
afterEach(async () => { for (const journal of journals.splice(0)) journal.close(); await Promise.all(directories.splice(0).map((path) => rm(path, { force: true, recursive: true }))); });

describe('RFC-034 development numeric journal', () => {
  test('reserve is durable before model spawn; replay never creates a second execution and secrets are absent', async () => {
    const path = await directory(), journal = open(path), original = admission(journal);
    expect(journal.reserve(original).created).toBe(true);
    journal.capture(original.key, capture, at); journal.running(original.key);
    expect(journal.reserve(original)).toMatchObject({ created: false, receipt: { phase: 'running', lastSequence: 1 } });
    const restarted = open(path);
    expect(restarted.reserve(original)).toMatchObject({ created: false, receipt: { phase: 'unknown', interruption: 'runner-restarted' } });
    expect(restarted.read(original.key, 0).events).toEqual([{ sequence: 1, occurredAt: at, capture }]);
    expect(() => restarted.finish(original.key, 'completed')).toThrow('不能伪造完成');
    const bytes = Buffer.concat(await Promise.all(['executions.sqlite', 'executions.sqlite-wal'].map((name) => readFile(join(path, name)))));
    expect(bytes.includes(Buffer.from('private-owner-prompt'))).toBe(false);
    expect(bytes.includes(Buffer.from(original.digestNonce))).toBe(false);
  });
  test('full journal loss cannot turn an old accepted key into an unadmitted execution', async () => {
    const path = await directory(), journal = open(path), original = admission(journal); journal.reserve(original);
    journal.close(); journals.splice(journals.indexOf(journal), 1);
    for (const name of ['executions.sqlite', 'executions.sqlite-wal', 'executions.sqlite-shm', 'journal.identity', 'development.pod']) await rm(join(path, name), { force: true });
    const fresh = open(path);
    expect(fresh.journalId).not.toBe(original.key.journalId);
    expect(() => fresh.info(original.key)).toThrow('原受理不同');
    expect(() => fresh.reserve(original)).toThrow('原受理不同');
  });
  test('confirmed numeric rows can be pruned while the immutable admission tombstone survives', async () => {
    const path = await directory(), journal = open(path), original = admission(journal); journal.reserve(original);
    for (let n = 0; n < 12; n++) journal.capture(original.key, capture, at);
    expect(journal.read(original.key, 0)).toMatchObject({ after: 0, through: 5 });
    const page = journal.read(original.key, 5);
    expect(page.events.map((event) => event.sequence)).toEqual([6, 7, 8, 9, 10]);
    expect(() => journal.acknowledge(original.key, 13)).toThrow('越过');
    expect(journal.acknowledge(original.key, 10).acknowledgedSequence).toBe(10);
    expect(journal.read(original.key, 10).events.map((event) => event.sequence)).toEqual([11, 12]);
    expect(() => journal.read(original.key, 9)).toThrow('已确认');
    journal.finish(original.key, 'completed'); journal.acknowledge(original.key, 12);
    const restarted = open(path);
    expect(restarted.info(original.key).receipt).toMatchObject({ phase: 'finished', finalThrough: 12, acknowledgedSequence: 12 });
    expect(restarted.reserve(original).created).toBe(false);
  });
  test('append failure at 10 still offers readable 9/10 and never invents sequence 11 or ACK 10', async () => {
    const journal = open(await directory()), original = admission(journal); journal.reserve(original);
    for (let n = 0; n < 10; n++) journal.capture(original.key, capture, at);
    journal.acknowledge(original.key, 8);
    journal.capture(original.key, { ...capture, diagnostics: ['x'.repeat(121)] }, at);
    journal.finish(original.key, 'completed');
    expect(journal.info(original.key).receipt).toMatchObject({ phase: 'finished', lastSequence: 10, acknowledgedSequence: 8, finalThrough: null, interruption: 'invalid-capture' });
    expect(journal.read(original.key, 8).events.map((event) => event.sequence)).toEqual([9, 10]);
    expect(() => journal.acknowledge(original.key, 11)).toThrow();
  });
  test('spool/response byte limits are explicit partial status, not ordinary execution failures', async () => {
    const journal = open(await directory(), randomUUID(), { eventBytes: 4096, pageBytes: 8192, spoolBytes: 1 }), original = admission(journal); journal.reserve(original);
    expect(() => journal.capture(original.key, capture, at)).not.toThrow();
    expect(journal.info(original.key).receipt).toMatchObject({ interruption: 'journal-limit', lastSequence: 0, finalThrough: null });
    journal.finish(original.key, 'completed');
    expect(journal.info(original.key).receipt).toMatchObject({ phase: 'finished', result: 'completed', finalThrough: null });
  });
  test('malformed/missing tail is irretrievable; wrong ownership, intent and Pod identity are rejected', async () => {
    const path = await directory(), journal = open(path), original = admission(journal); journal.reserve(original); journal.capture(original.key, capture, at);
    const connection = new Database(join(path, 'executions.sqlite'));
    connection.query('UPDATE events SET body=? WHERE execution_id=?').run('broken-json', original.key.executionId); connection.close();
    expect(() => journal.read(original.key, 0)).toThrow('已损坏');
    expect(journal.info(original.key).receipt?.interruption).toBe('journal-corrupt');
    expect(() => journal.info({ ...original.key, payloadDigest: 'b'.repeat(64) })).toThrow('原启动意图');
    expect(() => open(path, randomUUID(), limits, { ...context, podUid: 'replacement-pod' })).toThrow('Pod 归属');
    expect(() => open(path, randomUUID(), limits, { ...context, projectId: ProjectIdSchema.parse(resource(9)) })).toThrow('不同环境归属');
  });
  test('a missing admission header cannot make a persistent execution look unadmitted after restart', async () => {
    const path = await directory(), journal = open(path), original = admission(journal); journal.reserve(original);
    const storage = new Database(join(path, 'executions.sqlite')); storage.exec('DELETE FROM development_admissions'); storage.close();
    expect(() => open(path)).toThrow('身份头或执行归属丢失');
    expect(() => journal.info(original.key)).toThrow('日志记录丢失');
  });
  test('loss of a published marker or unsafe directory is rejected without making an empty replacement', async () => {
    const path = await directory(), journal = open(path), original = admission(journal); journal.reserve(original);
    await unlink(join(path, 'development.pod'));
    expect(() => open(path)).toThrow('丢失了 Pod 标记');
    await chmod(path, 0o755);
    expect(() => open(path)).toThrow('私有目录');
  });
  test('a real SQLite append failure freezes numeric N=10 while readable tail and independent finish survive', async () => {
    const path = await directory(), journal = open(path), original = admission(journal); journal.reserve(original);
    for (let n = 0; n < 10; n++) journal.capture(original.key, capture, at);
    journal.acknowledge(original.key, 8);
    const storage = new Database(join(path, 'executions.sqlite'));
    storage.exec("CREATE TRIGGER fail_append BEFORE INSERT ON events BEGIN SELECT RAISE(FAIL, 'disk append failed'); END;");
    expect(() => journal.capture(original.key, capture, at)).not.toThrow();
    journal.finish(original.key, 'completed');
    expect(journal.info(original.key).receipt).toMatchObject({ phase: 'finished', interruption: 'journal-unavailable', lastSequence: 10, acknowledgedSequence: 8, finalThrough: null });
    expect(journal.read(original.key, 8).events.map((e) => e.sequence)).toEqual([9, 10]);
    storage.close();
  });
  test('an ACK write failure rolls back row deletion and its numeric cursor atomically', async () => {
    const path = await directory(), journal = open(path), original = admission(journal); journal.reserve(original); journal.capture(original.key, capture, at);
    const storage = new Database(join(path, 'executions.sqlite'));
    storage.exec("CREATE TRIGGER fail_ack BEFORE DELETE ON events BEGIN SELECT RAISE(FAIL, 'ACK failed'); END;");
    expect(() => journal.acknowledge(original.key, 1)).toThrow('ACK failed');
    expect(journal.info(original.key).receipt?.acknowledgedSequence).toBe(0); expect(journal.read(original.key, 0).events).toHaveLength(1);
    storage.exec('DROP TRIGGER fail_ack;'); storage.close();
    expect(journal.acknowledge(original.key, 1).acknowledgedSequence).toBe(1);
    expect(journal.acknowledge(original.key, 1).acknowledgedSequence).toBe(1);
  });
  test('the page byte bound splits a tail without deleting, skipping or overconfirming it', async () => {
    const journal = open(await directory(), randomUUID(), { eventBytes: 700, pageBytes: 700, spoolBytes: 65536 }), original = admission(journal); journal.reserve(original);
    for (let n = 0; n < 5; n++) journal.capture(original.key, capture, at);
    const page = journal.read(original.key, 0);
    expect(page.events.length).toBeGreaterThan(0); expect(page.events.length).toBeLessThan(5);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(700);
    expect(journal.info(original.key).receipt?.lastSequence).toBe(5); expect(journal.info(original.key).receipt?.acknowledgedSequence).toBe(0);
    expect(journal.read(original.key, page.through).events[0]?.sequence).toBe(page.through + 1);
  });
  test('missing declared rows, forged capture keys and illegal bounds never become successful zero totals', async () => {
    const path = await directory(), journal = open(path), original = admission(journal); journal.reserve(original); journal.capture(original.key, capture, at);
    expect(() => journal.capture({ ...original.key, payloadDigest: 'b'.repeat(64) }, capture, at)).toThrow('当前受理不同');
    expect(journal.info(original.key).receipt?.interruption).toBeNull();
    expect(() => journal.read(original.key, 0, 6)).toThrow('读取范围');
    const storage = new Database(join(path, 'executions.sqlite')); storage.exec('DELETE FROM events'); storage.close();
    expect(() => journal.read(original.key, 0)).toThrow('无法读取');
    expect(() => open(path, randomUUID(), { eventBytes: 10, pageBytes: 1, spoolBytes: 1 })).toThrow('配置无效');
  });

  test('a rejected finish write keeps the known terminal in this process while restart remains unknown', async () => {
    const path = await directory(), journal = open(path), original = admission(journal); journal.reserve(original); journal.running(original.key); journal.capture(original.key, capture, at);
    const storage = new Database(join(path, 'executions.sqlite'));
    storage.exec("CREATE TRIGGER fail_finish BEFORE UPDATE ON executions WHEN NEW.phase='finished' BEGIN SELECT RAISE(FAIL, 'finish write failed'); END;");
    journal.finish(original.key, 'completed');
    expect(journal.info(original.key).receipt).toMatchObject({ phase: 'finished', result: 'completed', interruption: 'journal-unavailable', finalThrough: null, lastSequence: 1 });
    expect(journal.acknowledge(original.key, 1)).toMatchObject({ phase: 'finished', result: 'completed', acknowledgedSequence: 1, finalThrough: null });
    expect(journal.info(original.key).receipt).toMatchObject({ phase: 'finished', result: 'completed', finalThrough: null });
    journal.interrupt(original.key.executionId, 'missing-terminal');
    expect(journal.info(original.key).receipt).toMatchObject({ phase: 'finished', result: 'completed', interruption: 'journal-unavailable' });
    expect(() => journal.finish(original.key, 'error')).toThrow('不能替换');
    storage.close();
    const restarted = open(path);
    expect(restarted.info(original.key).receipt).toMatchObject({ phase: 'unknown', result: null, interruption: 'journal-unavailable', finalThrough: null, acknowledgedSequence: 1 });
    expect(restarted.reserve(original).created).toBe(false);
  });

});
