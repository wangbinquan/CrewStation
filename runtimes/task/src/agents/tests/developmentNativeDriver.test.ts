// Controlled actual driver/WAL/journal tests; no supplier invocation or bill.
import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createOpencodeDriver, recordOpencodeBinaryVersion } from '@crewstation/agent-drivers';
import type { AgentEvent } from '@crewstation/contracts';
import { noopLogger } from '@crewstation/kernel';
import { createFakeProcessHost } from '../../../../../packages/agent-drivers/tests/fakeProcessHost';
import { nativeProducerFixture, captureNativeProducerTurns } from './nativeProducerFixture';

for (const resume of [false, true]) test(`actual runtime adapter v2 ${resume ? 'initial resume' : 'fresh'} then resume retains pages without SDK duplicates`, async () => {
  await captureNativeProducerTurns(nativeProducerFixture(resume), resume);
}, 60_000);

for (const cancel of [false, true]) test(`original upstream bootstrap ${cancel ? 'cancelled and reaped' : 'nonzero exit'} never starts model or invents usage`, async () => {
  const f = nativeProducerFixture(false); recordOpencodeBinaryVersion('/bin/opencode', '1.18.29');
  const host = createFakeProcessHost([{ stdout: [], ...(cancel ? { onFrame: () => [] } : { exitCode: 17 }) }]);
  let kills = 0, started!: () => void; const spawned = new Promise<void>(resolve => { started = resolve; });
  const originalSpawn = host.spawnPiped; host.spawnPiped = spec => { const child = originalSpawn(spec); started(); return child; };
  const originalKill = host.killTree; host.killTree = async (child, grace) => { kills++; await originalKill(child, grace); };
  const run = createOpencodeDriver(() => '/bin/opencode').start({ agentId: f.admission.intent.identity.agentId, compute: 'validation-only', profileRevision: 2,
    launch: f.admission.intent.launch, permission: 'full', mode: 'oneshot', initialPrompt: 'first', mcp: [],
    usageObservationsV1: 1, nativeUsageTreeV1: 1, developmentNativePagesV2: 2, nativeUsageLineageKey: f.admission.intent.nativeUsageLineageKey },
    { cwd: f.directory, env: { HOME: f.directory, OPENCODE_DB: f.path }, host, logger: noopLogger,
      managed: { home: f.directory, runDir: join(f.directory, 'run') }, developmentNativeProducer: f.usage.nativeProducer });
  const events: AgentEvent[] = [];
  const pump = (async () => { for await (const event of run.events) { events.push(event); f.usage.observe(event); } })();
  if (cancel) { await spawned; expect(host.spawns).toHaveLength(1); await run.cancel(); }
  await pump;
  expect(host.spawns).toHaveLength(1); expect(host.spawns[0]!.cmd).toEqual(['/bin/opencode', 'db', 'SELECT 1', '--format', 'json']);
  expect(events.at(-1)?.type).toBe(cancel ? 'cancelled' : 'error'); expect(kills).toBe(cancel ? 1 : 0);
  expect(existsSync(f.path)).toBe(false); expect(f.journal.read(f.admission.key, 0).events).toEqual([]);
  expect(f.journal.info(f.admission.key).receipt?.interruption).toBe('invalid-capture');
  const read = f.readonly(); try {
    for (const table of ['development_native_turn_checkpoints', 'development_native_preparations', 'development_native_pages'])
      expect(read.query<{ total: number }, []>('SELECT count(*) AS total FROM ' + table).get()!.total).toBe(0);
  } finally { read.close(); }
}, 30_000);
