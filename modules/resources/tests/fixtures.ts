import type { Actor, ProjectId, ResourceChild, UserId } from '@crewstation/contracts';
import type { Clock } from '@crewstation/kernel';
import { forbidden } from '@crewstation/kernel';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase } from '@crewstation/testkit';
import type { StreamOptions } from '../application/streamHub';
import type { ResourceDeclaration } from '../api/types';
import type { ResourcesModule } from '../wiring';
import { createResourcesModule, resourcesMigrations } from '../wiring';

export const PROJECT = '01a0bf5d-8f4b-7c01-8e19-e226732a75a4' as ProjectId;
export const OTHER_PROJECT = '01a0bf5d-8f4b-7c01-8e19-e226732a75a5' as ProjectId;
export const DEVELOPER = { userId: '01a0bf5d-8f4b-7c01-8e19-e226732a7501' as UserId, isAdmin: false } satisfies Actor;
export const TESTER = { userId: '01a0bf5d-8f4b-7c01-8e19-e226732a7502' as UserId, isAdmin: false } satisfies Actor;
export const OUTSIDER = { userId: '01a0bf5d-8f4b-7c01-8e19-e226732a7503' as UserId, isAdmin: false } satisfies Actor;
export const ADMIN = { userId: '01a0bf5d-8f4b-7c01-8e19-e226732a7504' as UserId, isAdmin: true } satisfies Actor;

/** 可拨动的时钟：保留期、阶段起始时间都按它算。 */
export function movableClock(iso = '2026-09-23T12:00:00.000Z'): Clock & { advance(ms: number): void; set(at: Date): void } {
  let at = new Date(iso);
  return { now: () => new Date(at), advance: (ms) => { at = new Date(at.getTime() + ms); }, set: (next) => { at = new Date(next); } };
}

export interface Harness {
  readonly database: TestDatabase;
  readonly module: ResourcesModule;
  readonly clock: ReturnType<typeof movableClock>;
  readonly quota: { limit: number | undefined };
  /** 授权回答可以在用例中途改（模拟被移出项目）。 */
  readonly members: Map<string, 'developer' | 'tester'>;
}

export async function createHarness(stream: Partial<StreamOptions> = {}): Promise<Harness> {
  const database = await createTestDatabase([resourcesMigrations]);
  const clock = movableClock();
  const quota = { limit: 2 as number | undefined };
  const members = new Map<string, 'developer' | 'tester'>([[DEVELOPER.userId, 'developer'], [TESTER.userId, 'tester']]);
  const module = createResourcesModule({
    db: database.db, clock, stream: { pollMs: 20, ...stream },
    quotas: { limitFor: async () => quota.limit },
    authorizer: {
      projectAccess: async (actor, projectId) => {
        if (actor.isAdmin) return { operate: true };
        const role = projectId === PROJECT ? members.get(actor.userId) : undefined;
        if (!role) throw forbidden('不是这个项目的成员');
        return { operate: role === 'developer' };
      },
    },
    isAdmin: async (id) => id === ADMIN.userId,
  });
  return { database, module, clock, quota, members };
}

export const pod = (name: string, patch: Partial<ResourceChild> = {}): ResourceChild => ({ kind: 'Pod', namespace: 'cs-demo', name, phase: 'Running', ready: true, ...patch });

export function workspace(ref: string, patch: Partial<ResourceDeclaration> = {}): ResourceDeclaration {
  return { kind: 'dev-workspace', ref, projectId: PROJECT, purpose: 'development-workspace', spec: { children: [{ kind: 'Pod', namespace: 'cs-demo', name: `task-${ref}` }] }, display: { branch: 'main' }, ...patch };
}

export function execution(ref: string, parentId: string, patch: Partial<ResourceDeclaration> = {}): ResourceDeclaration {
  return { kind: 'agent-execution', ref, projectId: PROJECT, parentId, purpose: 'development-cli', spec: { children: [{ kind: 'Pod', namespace: 'cs-demo', name: `exec-${ref}` }] }, ...patch };
}
