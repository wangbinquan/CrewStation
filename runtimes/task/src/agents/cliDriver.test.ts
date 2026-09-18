import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent } from '@crewstation/contracts';
import { noopLogger } from '@crewstation/kernel';
import { RunnerCommandError } from '../commandError';
import { createProcessLauncher } from '../process/launcher';
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
