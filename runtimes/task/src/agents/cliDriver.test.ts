import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { recordOpencodeBinaryVersion, resetOpencodeBinaryVersions, resetOpencodeProbes } from '@crewstation/agent-drivers';
import type { DevelopmentRunnerUsageCapture, AgentEvent } from '@crewstation/contracts';
import { noopLogger } from '@crewstation/kernel';
import { RunnerCommandError } from '../commandError';
import { createProcessLauncher, type PipedProcess } from '../process/launcher';
import { probeCurrentUid, resolveIsolation } from '../process/privilege';
import { createCliDriverFactory } from './cliDriver';
import type { AgentSpec } from './driver';

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe('CLI 驱动工厂（RFC-006：按协议取驱动，二进制随每次启动下发）', () => {
  test('两种已知协议各一个驱动，协议与契约一致', () => {
    const drivers = createCliDriverFactory({ which: () => null });
    expect(drivers.forProtocol('claude-code').protocol).toBe('claude-code');
    expect(drivers.forProtocol('opencode').protocol).toBe('opencode');
  });

  test('按档位给的绝对路径判断二进制；不在位只发 driver_not_installed，状态错误转成协议错误码', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cs-cli-driver-'));
    try {
      const seen: string[] = [];
      const drivers = createCliDriverFactory({ which: (binary) => { seen.push(binary); return null; } });
      const launcher = createProcessLauncher({ isolation: resolveIsolation({ uid: 10001, gid: 10001, currentUid: probeCurrentUid(), which: (b) => Bun.which(b) }), processEnv: process.env, workerHome: root, logger: noopLogger });
      const spec: AgentSpec = { agentId: 'fork', compute: 'balanced', profileRevision: 2, launch: { protocol: 'claude-code', binaryPath: '/opt/fork/bin/claude', extraArgs: [], isSandbox: false }, permission: 'edit', mode: 'interactive', mcp: [] };
      const agent = drivers.forProtocol('claude-code').start(spec, { cwd: root, env: {}, launcher, logger: noopLogger, managed: { home: join(root, 'home'), runDir: root } });
      const events = await collect(agent.events);
      expect(seen).toEqual(['/opt/fork/bin/claude']);
      expect(events.map((e) => [e.type, e.error?.code])).toEqual([['error', 'driver_not_installed']]);
      expect(events[0]?.error?.message).toBe('driver binary not installed: /opt/fork/bin/claude');
      const failure = await agent.send('hi').catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(RunnerCommandError);
      expect((failure as RunnerCommandError).code).toBe('agent_not_running');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test('the real Runner CLI adapter preserves source selection and leaves unselected numeric frames unchanged', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-cli-source-adapter-'));
  try {
    const path = join(root, 'native.db'), db = new Database(path), at = Date.now();
    db.exec('CREATE TABLE session(id TEXT PRIMARY KEY,parent_id TEXT); CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,data TEXT); CREATE TABLE part(id TEXT PRIMARY KEY,session_id TEXT,message_id TEXT,time_created INTEGER,data TEXT)');
    db.query('INSERT INTO session VALUES(?,?)').run('root', null);
    db.query('INSERT INTO message VALUES(?,?,?)').run('message', 'root', JSON.stringify({ role: 'assistant', providerID: 'actual-provider', modelID: 'actual-model' }));
    const numeric = { type: 'step-finish', tokens: { input: 10, output: 3, cache: { read: 2, write: 0 } } };
    db.query('INSERT INTO part VALUES(?,?,?,?,?)').run('step', 'root', 'message', at, JSON.stringify(numeric)); db.close();
    const raw = JSON.stringify({ type: 'step_finish', sessionID: 'root', timestamp: at, part: { ...numeric, id: 'step', sessionID: 'root', messageID: 'message' } });
    for (const selected of [false, true]) {
      recordOpencodeBinaryVersion('/bin/opencode', '1.18.29');
      const frames: DevelopmentRunnerUsageCapture[] = []; let spawns = 0;
      const launcher = { ...createProcessLauncher({ isolation: resolveIsolation({ uid: 10001, gid: 10001, currentUid: probeCurrentUid(), which: (b) => Bun.which(b) }), processEnv: {}, workerHome: root, logger: noopLogger }),
        spawnPiped: () => { spawns++; return { pid: 0, stdout: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(raw + '\n')); c.close(); } }), stderr: new ReadableStream<Uint8Array>({ start(c) { c.close(); } }), exited: Promise.resolve(0), exitCode: 0, signalCode: null } as PipedProcess; } };
      const spec: AgentSpec = { agentId: selected ? 'selected' : 'legacy', compute: 'named', profileRevision: 1, launch: { protocol: 'opencode', binaryPath: '/bin/opencode', extraArgs: [], isSandbox: false }, permission: 'full', mode: 'oneshot', initialPrompt: 'private', mcp: [], usageObservationsV1: 1, nativeUsageTreeV1: 1, nativeUsageLineageKey: 'namespace', ...(selected ? { developmentNativeSourceV1: 1 as const } : {}) };
      // This must traverse toDriverSpec; testing the package driver directly misses a dropped opt-in flag.
      const events = await collect(createCliDriverFactory({ which: () => '/bin/opencode' }).forProtocol('opencode').start(spec, { cwd: root, env: { HOME: root, OPENCODE_DB: path }, launcher, logger: noopLogger, managed: { home: root, runDir: join(root, spec.agentId) }, usageSink: (f) => frames.push(f) }).events);
      expect(spawns).toBe(1); expect(events.at(-1)?.type).toBe('completed'); expect(events.some((e) => e.type === 'usage')).toBe(false);
      expect(frames.filter((f) => f.nativeSource).map((f) => f.nativeSource?.stage)).toEqual(selected ? ['begin', 'finish'] : []);
      expect(frames.flatMap((f) => f.measurements)[0]?.actualModel?.model).toBe('actual-model');
    }
  } finally { resetOpencodeBinaryVersions(); resetOpencodeProbes(); await rm(root, { recursive: true, force: true }); }
});
