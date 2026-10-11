// Regression for the real RFC-034 resumed turn that completed after sendMessage timed out.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent } from '@crewstation/contracts';
import { noopLogger } from '@crewstation/kernel';
import type { DriverAgentSpec } from '../contract/agentDriver';
import { createOpencodeDriver } from '../drivers/opencode/driver';
import { resetOpencodeProbes } from '../drivers/opencode/probe';
import { recordOpencodeBinaryVersion, resetOpencodeBinaryVersions } from '../drivers/opencode/versionRegistry';
import { createFakeProcessHost } from './fakeProcessHost';

const roots: string[] = [];
beforeEach(() => { resetOpencodeBinaryVersions(); resetOpencodeProbes(); recordOpencodeBinaryVersion('/bin/opencode', '1.18.29'); });
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); resetOpencodeBinaryVersions(); resetOpencodeProbes(); });
function signal() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }

for (const outcome of ['complete', 'failure', 'cancel'] as const) {
  test(`resumed message is acknowledged while the original model process is still running: ${outcome}`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'cs-chained-admission-')); roots.push(root);
    const host = createFakeProcessHost([
      { stdout: ['{"type":"text","sessionID":"original-root","part":{"type":"text","text":"first"}}', '{"type":"step_finish","sessionID":"original-root"}'] },
      // Hold actual stream EOF and process exit independently of the command acknowledgement.
      { stdout: ['{"type":"text","sessionID":"original-root","part":{"type":"text","text":"second"}}'], onFrame: () => [] },
    ]);
    const spawned = signal(), firstIdle = signal(), secondIdle = signal();
    const originalSpawn = host.spawnPiped;
    let secondExited = false;
    host.spawnPiped = (input) => {
      const child = originalSpawn(input);
      if (host.spawns.length === 2) { void child.exited.then(() => { secondExited = true; }); spawned.resolve(); }
      return child;
    };
    const kills: Array<{ pid: number; grace: number | undefined }> = [], originalKill = host.killTree;
    host.killTree = async (child, grace) => { kills.push({ pid: child.pid, grace }); await originalKill(child, grace); };
    const spec: DriverAgentSpec = { agentId: 'original-agent', compute: 'acceptance-only', profileRevision: 4,
      launch: { protocol: 'opencode', binaryPath: '/bin/opencode', extraArgs: [], isSandbox: false }, permission: 'full', mode: 'interactive', initialPrompt: 'first', mcp: [] };
    const agent = createOpencodeDriver(() => '/bin/opencode').start(spec, { cwd: root, env: {}, host, logger: noopLogger, runDir: join(root, 'run') });
    const events: AgentEvent[] = []; let idleCount = 0;
    const pump = (async () => { for await (const event of agent.events) { events.push(event); if (event.type === 'status' && event.status === 'waiting') { idleCount++; (idleCount === 1 ? firstIdle : secondIdle).resolve(); } } })();
    let delivery: Promise<void> | undefined, acknowledged = false;
    try {
      await firstIdle.promise;
      delivery = agent.send('second').then(() => { acknowledged = true; });
      await spawned.promise; await Promise.resolve();
      // The old implementation waits for model exit here and causes the real command timeout.
      expect(acknowledged).toBe(true);
      expect(secondExited).toBe(false);
      expect(idleCount).toBe(1);
      expect(host.spawns).toHaveLength(2);
      expect(host.spawns[1]?.cmd.slice(-4)).toEqual(['--session', 'original-root', '--', 'second']);
      if (outcome === 'cancel') {
        await agent.cancel(); await pump;
        expect(kills).toEqual([{ pid: 1002, grace: 5000 }]);
        expect(events.at(-1)?.type).toBe('cancelled');
        expect(idleCount).toBe(1);
      } else {
        host.finishResident(outcome === 'failure' ? 1 : 0);
        if (outcome === 'complete') {
          await secondIdle.promise;
          expect(idleCount).toBe(2);
          expect(events.filter((event) => event.type === 'text').map((event) => event.text)).toEqual(['first', 'second']);
          await agent.cancel(); await pump;
          expect(events.at(-1)?.type).toBe('cancelled');
        } else {
          await pump;
          expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'agent_failed' } });
          expect(idleCount).toBe(1);
        }
      }
      expect(secondExited).toBe(true);
      await delivery;
    } finally {
      host.finishResident();
      await delivery?.catch(() => undefined);
      await agent.cancel(); await pump;
    }
  });
}
