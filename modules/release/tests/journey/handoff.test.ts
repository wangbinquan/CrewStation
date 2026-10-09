import { afterEach, describe, expect, test } from 'bun:test';
import { newResourceId, noopLogger } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { executionHandoffFixture } from '../executionHandoffFixture';
import { journeyObserver } from '../../application/journey/observer';
import { createJourney } from '../../application/journey/recording';
import { recordJourneyLaunch } from '../../application/journey/launch';
import { switchToDto } from '../../application/toDto';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-038 original fenced operation history', () => {
  let f: Awaited<ReturnType<typeof executionHandoffFixture>>;
  afterEach(async () => { await f?.close(); });
  test('accepting a fenced successor preserves the prior pending result until the successor is actually observed', async () => {
    f = await executionHandoffFixture();
    const prior = await f.uow.run(async scope => {
      const journey = await createJourney(scope, f.old, f.actor.userId, 'promote', { kind: 'external' }, f.deps.clock.now());
      const record = { id: newResourceId(), serviceId: f.serviceId, fromSlot: 'preview' as const, toSlot: 'prod' as const, releaseId: f.old.id, actorUserId: f.actor.userId, createdAt: f.deps.clock.now() };
      await scope.switches.insert(record);
      await recordJourneyLaunch(scope, journey, { toSlot: 'preview' }, switchToDto(record), f.old, { ...(await scope.slots.get(f.serviceId))!, active: 'green' }, f.deps.clock.now());
      return (await scope.journeys.snapshot(journey.id))!;
    });
    const successor = await f.start();
    expect(await f.uow.read.journeys.snapshot(prior.journey.id)).toEqual(prior);
    const progress = journeyObserver({ ...f.deps, hosts: { prodHost: () => 'prod', previewHost: () => 'preview' }, logger: noopLogger });
    await f.worker().progressHandoffs(); f.prepared(); await f.worker().progressHandoffs(); await f.worker().progressHandoffs(); await f.worker().progressHandoffs();
    expect(await progress()).toBe(0); expect(await f.uow.read.journeys.snapshot(prior.journey.id)).toEqual(prior);
    f.state.routed = true; await f.worker().progressHandoffs(); f.state.authority.stage = 'complete'; await f.worker().progressHandoffs();
    expect(await progress()).toBe(1);
    expect((await f.uow.read.journeys.get(prior.journey.id))?.status).toBe('interrupted');
    expect((await f.uow.read.journeys.get(successor.journeyId!))?.status).toBe('succeeded');
  });
  test('durable handoff facts survive stages, route and activation must both finish; linked birth cannot be changed', async () => {
    f = await executionHandoffFixture(); const operation = await f.start(), id = operation.journeyId!;
    const progress = journeyObserver({ ...f.deps, hosts: { prodHost: () => 'prod', previewHost: () => 'preview' }, logger: noopLogger });
    expect(await progress()).toBe(0);
    await f.worker().progressHandoffs(); f.prepared(); await f.worker().progressHandoffs(); await f.worker().progressHandoffs(); await f.worker().progressHandoffs();
    expect((await f.uow.read.journeys.get(id))?.status).toBe('running');
    expect(await progress()).toBe(0); f.state.routed = true; await f.worker().progressHandoffs();
    expect(await progress()).toBe(0); f.state.authority.stage = 'complete'; await f.worker().progressHandoffs();
    expect(await progress()).toBe(1);
    const snapshot = await f.uow.read.journeys.snapshot(id);
    expect(snapshot?.journey.status).toBe('succeeded');
    for (const stage of ['freeze', 'handoff-prepare', 'route', 'activate', 'complete']) expect(snapshot?.events.some(event => event.stage === stage && event.state === 'succeeded')).toBe(true);
    expect((await f.start()).id).toBe(operation.id); expect(await f.uow.read.journeys.snapshot(id)).toEqual(snapshot);
    await expect(Promise.resolve(f.database.db.execute(sql`UPDATE release.execution_handoffs SET body=jsonb_set(body,'{journeyId}',${JSON.stringify(newResourceId())}::jsonb) WHERE id=${operation.id}`))).rejects.toThrow();
    await expect(f.uow.read.journeys.append(id, { transitionKey: 'late-foreign', stage: 'route', state: 'running', at: f.deps.clock.now().toISOString(), handoffId: newResourceId() })).rejects.toThrow();
  });
});
