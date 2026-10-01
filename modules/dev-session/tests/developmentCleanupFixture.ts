// Isolated original-owner/ending regressions with controlled transport; actual numeric copy is root E2E.
import type { Database } from '@crewstation/persistence';
import { newResourceId } from '@crewstation/kernel';
import { developmentEndingFixture } from './developmentEndingFixture';
import { developmentCleanupParticipant } from '../application/development/cleanup';
import { DevelopmentCleanupSelectionSchema } from '../domain/development/cleanup';
import { createDevSessionModule } from '../wiring';
import { workspaceFixture } from './workspaceFixture';

export async function developmentCleanupFixture(db: Database, bound = true) {
  const f = await developmentEndingFixture(db, { bound });
  f.child.state = 'releasing'; f.child.native!.state = 'cleaning'; f.envs.set(f.child.id, f.child);
  const control = { missingCopy: false, copyOverride: undefined as unknown };
  const session = { ...f.session, getDevelopmentUsage: async (id: typeof f.child.id) => control.missingCopy ? undefined : structuredClone(control.copyOverride ?? f.stored.get(id)) as Awaited<ReturnType<typeof f.session.registerDevelopmentUsage>> | undefined };
  const deps = { ...f.deps, session, environments: f.environmentPort }, participant = developmentCleanupParticipant(deps);
  const input = DevelopmentCleanupSelectionSchema.parse({ version: 1, identity: f.preparation.intent.identity, profileId: f.start.profile.profileId,
    profileRevision: f.start.profile.revision, podUid: f.info.podUid, consumerId: newResourceId(), renderStart: 1, selectionHash: 'b'.repeat(64) });
  const module = (enabled: boolean) => {
    const base = workspaceFixture().deps;
    return createDevSessionModule({ ...base, db, isAdmin: async () => true, developmentUsagePricing: f.pricing,
      environments: { ...base.environments, getEnvironment: f.environmentPort.getEnvironment }, clock: f.deps.clock,
      ...(enabled ? { developmentCleanupSession: session } : {}) });
  };
  return { ...f, session, participant, input, cleanupControl: control, module };
}
