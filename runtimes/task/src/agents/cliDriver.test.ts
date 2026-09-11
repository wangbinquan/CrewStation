import { describe, expect, test } from 'bun:test';
import type { AgentEvent } from '@crewstation/contracts';
import { noopLogger } from '@crewstation/kernel';
import type { ProcessLauncher } from '../process/launcher';
import { createCliDriver } from './cliDriver';
import type { AgentSpec } from './driver';
import { createDriverRegistry } from './registry';

const spec: AgentSpec = { agentId: 'a', driver: 'claude-code', model: 'anthropic/claude-sonnet-4', permission: 'edit', mode: 'oneshot', mcp: [] };
const context = { cwd: '/tmp', env: {}, launcher: {} as ProcessLauncher, logger: noopLogger };

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

describe('CLI 占位驱动', () => {
  test('二进制缺失：error 事件 driver binary not installed，流随即结束', async () => {
    const driver = createCliDriver({ name: 'claude-code', binary: 'claude', which: () => null });
    expect(driver.available()).toBe(false);
    const agent = driver.start(spec, context);
    const events = await collect(agent.events);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ agentId: 'a', seq: 1, type: 'error', error: { code: 'driver_not_installed', message: 'driver binary not installed: claude' } });
    await expect(agent.send('x')).rejects.toMatchObject({ code: 'agent_not_running' });
    await agent.cancel();
  });
  test('二进制存在但实现尚未接入：error 事件 driver_not_implemented', async () => {
    const driver = createCliDriver({ name: 'opencode', binary: 'opencode', which: () => '/usr/local/bin/opencode' });
    const events = await collect(driver.start({ ...spec, driver: 'opencode' }, context).events);
    expect(events[0]?.error?.code).toBe('driver_not_implemented');
  });
});

describe('驱动注册表', () => {
  test('内建三种驱动，只宣告 stub 可用；重复注册报错', () => {
    const registry = createDriverRegistry();
    expect(registry.names().sort()).toEqual(['claude-code', 'opencode', 'stub']);
    expect(registry.available()).toEqual(['stub']);
    expect(registry.get('stub')?.name).toBe('stub');
    expect(registry.get('claude-code')?.available()).toBe(false);
    const stub = registry.get('stub');
    expect(() => createDriverRegistry([stub!, stub!])).toThrow(/重复注册/);
  });
});
