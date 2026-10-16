import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AgentEvent } from '@crewstation/contracts';
import { LaunchSpecSchema } from '@crewstation/contracts';
import { noopLogger } from '@crewstation/kernel';
import { claudeStartupInventory } from '../drivers/claudeCode/startupInventory';
import { createClaudeCodeDriver } from '../drivers/claudeCode/driver';
import { createCliAgentDriver } from '../drivers/cliAgentDriver';
import { readStartupInventory, renderStartupInventoryPlugin } from '../drivers/opencode/startupInventory';
import { createFakeProcessHost } from './fakeProcessHost';
const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const fn of cleanups.splice(0)) await fn(); });
async function root() { const path = await mkdtemp(join(tmpdir(), 'startup-inventory-test-')); cleanups.push(() => rm(path, { recursive: true, force: true })); return path; }
const spec = () => ({ agentId: crypto.randomUUID(), compute: 'profile', profileRevision: 1, launch: LaunchSpecSchema.parse({ protocol: 'claude-code', binaryPath: '/bin/claude' }), mode: 'oneshot' as const, permission: 'full' as const, mcp: [], initialPrompt: 'hello', startupInventoryVersion: 1 as const, businessEvents: true });
test('Claude root init projects observed names and statuses while omitting diagnostics, URLs and optional absent faces', () => {
  const report = claudeStartupInventory({ mcp_servers: [{ name: 'docs', status: 'failed', error: 'private-token', url: 'https://private.test' }], tools: ['Read'], unrelated: 'private' });
  expect(report).toEqual({ version: 1, state: 'verified', source: 'claude-init', mcpServers: [{ name: 'docs', status: 'failed' }], tools: ['Read'] });
  expect(claudeStartupInventory({})).toMatchObject({ state: 'unavailable' });
  expect(claudeStartupInventory({ mcp_servers: [null] })).toMatchObject({ state: 'malformed' });
  expect(claudeStartupInventory({ mcp_servers: 'bad' })).toMatchObject({ state: 'malformed' });
});
test('the OpenCode observer queries runtime APIs and binds its output to the exact attempt and root session', async () => {
  const path = await root(), output = join(path, 'inventory.json'), file = join(path, 'observer.mjs');
  await writeFile(file, renderStartupInventoryPlugin(output, 'attempt-nonce'));
  const plugin = (await import(pathToFileURL(file).href)).default;
  const hooks = await plugin.server({ client: { session: { get: async () => ({ data: { id: 'root' } }) }, mcp: { status: async () => ({ data: { docs: { status: 'connected', headers: { authorization: 'private' } } } }) }, app: { agents: async () => ({ data: [{ name: 'review', prompt: 'private' }] }) } } });
  await hooks['chat.message']({ sessionID: 'root' });
  expect(readStartupInventory(output, 'attempt-nonce', 'root')).toEqual({ version: 1, state: 'verified', source: 'opencode-inventory', mcpServers: [{ name: 'docs', status: 'connected' }], agents: ['review'] });
  expect(await readFile(output, 'utf8')).not.toContain('private');
  expect(readStartupInventory(output, 'different-attempt', 'root')).toMatchObject({ state: 'malformed', reason: 'inventory-identity-mismatch' });
  expect(readStartupInventory(output, 'attempt-nonce', 'other-root')).toMatchObject({ state: 'malformed' });
  await writeFile(output, 'broken-private-json'); expect(readStartupInventory(output, 'attempt-nonce', 'root')).toEqual({ version: 1, state: 'malformed', reason: 'inventory-malformed' });
  await writeFile(output, 'x'.repeat(300_000)); expect(readStartupInventory(output, 'attempt-nonce', 'root')).toMatchObject({ state: 'unavailable', reason: 'inventory-too-large' });
});
test('root inventory is emitted once before the terminal event; subagent init does not claim the root inventory', async () => {
  const path = await root(), init = { type: 'system', subtype: 'init', session_id: 'root', mcp_servers: [{ name: 'docs', status: 'connected' }] };
  const host = createFakeProcessHost([{ stdout: [JSON.stringify({ ...init, parent_tool_use_id: 'child', mcp_servers: [{ name: 'other', status: 'failed' }] }), JSON.stringify(init), JSON.stringify(init), JSON.stringify({ type: 'result', session_id: 'root', is_error: false })] }]);
  const run = createClaudeCodeDriver(() => '/bin/claude').start(spec(), { cwd: path, runDir: join(path, 'run'), env: {}, host, logger: noopLogger });
  const events: AgentEvent[] = []; for await (const event of run.events) events.push(event);
  expect(events.filter((event) => event.type === 'startup-inventory')).toHaveLength(1);
  expect(events.find((event) => event.type === 'startup-inventory')?.inventory).toMatchObject({ state: 'verified', mcpServers: [{ name: 'docs', status: 'connected' }] });
  expect(events.at(-1)?.type).toBe('completed');
});
test('cancellation during asynchronous preparation aborts the download barrier and never constructs a CLI process', async () => {
  const path = await root(), host = createFakeProcessHost([]), entered = Promise.withResolvers<void>();
  const driver = createCliAgentDriver({ protocol: 'claude-code', supportsResidentStream: false, prepare: async (_spec, context) => {
    entered.resolve(); await new Promise((_resolve, reject) => { context.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); }); throw new Error('unreachable');
  } }, () => '/bin/claude');
  const run = driver.start(spec(), { cwd: path, env: {}, host, logger: noopLogger }); await entered.promise;
  await run.cancel(); const events: AgentEvent[] = []; for await (const event of run.events) events.push(event);
  expect(host.spawns).toHaveLength(0); expect(events.map((event) => event.type)).toEqual(['startup-inventory', 'cancelled']);
  expect(events[0]?.inventory).toMatchObject({ state: 'unavailable', reason: 'inventory-cancelled' });
});
