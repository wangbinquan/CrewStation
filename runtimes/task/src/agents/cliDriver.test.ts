import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { parseOpencodeEvent, recordOpencodeBinaryVersion, resetOpencodeBinaryVersions, resetOpencodeProbes } from '@crewstation/agent-drivers';
import type { AgentEvent } from '@crewstation/contracts';
import { noopLogger } from '@crewstation/kernel';
import { RunnerCommandError } from '../commandError';
import { createProcessLauncher, type PipedProcess } from '../process/launcher';
import { probeCurrentUid, resolveIsolation } from '../process/privilege';
import { createCliDriverFactory, createProcessHost } from './cliDriver';
import type { AgentSpec } from './driver';

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe('Runner CLI 协议行边界', () => {
  const host = createProcessHost(createProcessLauncher({ isolation: resolveIsolation({ uid: 10001, gid: 10001, currentUid: 501, which: () => null }), processEnv: {}, workerHome: '/tmp', logger: noopLogger }));
  const stream = (text: string, chunkBytes: number) => new ReadableStream<Uint8Array>({
    start(controller) {
      const bytes = new TextEncoder().encode(text);
      for (let offset = 0; offset < bytes.length; offset += chunkBytes) controller.enqueue(bytes.slice(offset, offset + chunkBytes));
      controller.close();
    },
  });

  test('长工具回执跨输出帧和 UTF-8 分块仍是一条工具事件，后续正文完整', async () => {
    const output = '贪吃蛇源文件\n'.repeat(8000);
    const raw = JSON.stringify({ type: 'tool_use', sessionID: 'session', part: { type: 'tool', tool: 'read', callID: 'read-game', state: { status: 'completed', input: { filePath: '/work/src/game.ts' }, output } } });
    const lines: string[] = [];
    await host.pumpLines(stream(`${raw}\n${JSON.stringify({ type: 'text', part: { type: 'text', text: '已检查游戏规则。' } })}`, 32767), line => lines.push(line));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(raw);
    expect(parseOpencodeEvent(lines[0]!)).toMatchObject({ kind: 'tool_use', text: null, tool: { name: 'read', callId: 'read-game', output } });
    expect(parseOpencodeEvent(lines[1]!)?.text).toBe('已检查游戏规则。');
  });

  test.each(['', '\n'])('超限协议行明确失败，不把不完整 JSON 当作正文（结尾 %j）', async suffix => {
    const lines: string[] = [];
    await expect(host.pumpLines(stream('x'.repeat(1024 * 1024 + 1) + suffix, 32768), line => lines.push(line))).rejects.toThrow('Protocol output line exceeds 1048576 characters');
    expect(lines).toEqual([]);
  });
});

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

// RFC-034 v2：Runner 适配层只传最终环境，OpenCode 计量器据此在轮末只读汇总原生存储，换成实际模型。
test('the real Runner CLI adapter meters OpenCode usage from the final process environment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-cli-usage-adapter-'));
  try {
    // 原生步骤时间晚于执行开始（时间下界只排除恢复会话的历史）。
    const path = join(root, 'native.db'), db = new Database(path), at = Date.now() + 60_000;
    db.exec('CREATE TABLE session(id TEXT PRIMARY KEY,parent_id TEXT); CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,data TEXT); CREATE TABLE part(id TEXT PRIMARY KEY,session_id TEXT,message_id TEXT,time_created INTEGER,data TEXT)');
    db.query('INSERT INTO session VALUES(?,?)').run('root', null);
    db.query('INSERT INTO message VALUES(?,?,?)').run('message', 'root', JSON.stringify({ role: 'assistant', providerID: 'actual-provider', modelID: 'actual-model' }));
    const numeric = { type: 'step-finish', tokens: { input: 10, output: 3, cache: { read: 2, write: 0 } } };
    db.query('INSERT INTO part VALUES(?,?,?,?,?)').run('step', 'root', 'message', at, JSON.stringify(numeric)); db.close();
    const raw = JSON.stringify({ type: 'step_finish', sessionID: 'root', timestamp: at, part: { ...numeric, id: 'step', sessionID: 'root', messageID: 'message' } });
    recordOpencodeBinaryVersion('/bin/opencode', '1.18.29');
    let spawns = 0;
    const launcher = { ...createProcessLauncher({ isolation: resolveIsolation({ uid: 10001, gid: 10001, currentUid: probeCurrentUid(), which: (b) => Bun.which(b) }), processEnv: {}, workerHome: root, logger: noopLogger }),
      spawnPiped: () => { spawns++; return { pid: 0, stdout: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(raw + '\n')); c.close(); } }), stderr: new ReadableStream<Uint8Array>({ start(c) { c.close(); } }), exited: Promise.resolve(0), exitCode: 0, signalCode: null } as PipedProcess; } };
    const spec: AgentSpec = { agentId: 'metered', compute: 'named', profileRevision: 1, launch: { protocol: 'opencode', binaryPath: '/bin/opencode', extraArgs: [], isSandbox: false }, permission: 'full', mode: 'oneshot', initialPrompt: 'private', mcp: [] };
    const events = await collect(createCliDriverFactory({ which: () => '/bin/opencode' }).forProtocol('opencode').start(spec, { cwd: root, env: { HOME: root, OPENCODE_DB: path }, launcher, logger: noopLogger, managed: { home: root, runDir: join(root, spec.agentId) } }).events);
    const final = { state: 'complete' as const, models: [{ model: 'actual-provider/actual-model', input: 10, cacheRead: 2, cacheWrite: 0, output: 3, reasoning: 0 }] };
    expect(spawns).toBe(1);
    expect(events.filter((e) => e.type === 'usage').at(-1)?.usageSnapshot).toEqual(final);
    expect(events.at(-1)).toMatchObject({ type: 'completed', usageSnapshot: final });
  } finally { resetOpencodeBinaryVersions(); resetOpencodeProbes(); await rm(root, { recursive: true, force: true }); }
});
