import { describe, expect, test } from 'bun:test';
import type { ProjectId, ServiceId } from '@crewstation/contracts';
import { noopLogger } from '@crewstation/kernel';
import { provisionProjectUseCase } from '../application/provisionProject';
import type { ProjectFacts, ProvisioningSteps } from '../api/steps';

const facts: ProjectFacts = {
  projectId: '01a0bf5d-8f4b-7178-82e1-9a99060b1192' as ProjectId, state: 'provisioning', serviceId: '01a0bf5d-8f4b-76c5-866c-f1feda3d63bb' as ServiceId,
  slug: 'demo', name: 'demo', namespace: 'cs-demo', kind: 'DigitalWorker', template: '01a0bf5d-8f4b-7002-9560-94caf593fb19',
};

describe('provisioning', () => {
  test('按顺序执行各步并推进 active；某步失败则记 failed 并停止', async () => {
    const calls: string[] = [];
    const states: string[] = [];
    const make = (failAt?: string, from: ProjectFacts = facts): ProvisioningSteps => ({
      loadProject: async () => from,
      ensureNamespace: async () => { calls.push('ns'); },
      ensureRepository: async () => { calls.push('repo'); if (failAt === 'repo') throw new Error('gitlab down'); },
      ensureData: async () => { calls.push('data'); },
      reconcileRoutes: async () => { calls.push('routes'); },
      ensureFirstRelease: async () => { calls.push('release'); },
      setProjectState: async (_p, state, message) => { states.push(`${state}${message ? `:${message}` : ''}`); },
    });
    expect(await provisionProjectUseCase(make(), noopLogger)(facts.projectId)).toBe('active');
    expect(calls).toEqual(['ns', 'repo', 'data', 'routes', 'release']);
    expect(states).toEqual(['active']);
    calls.length = 0; states.length = 0;
    expect(await provisionProjectUseCase(make('repo'), noopLogger)(facts.projectId)).toBe('failed');
    expect(calls).toEqual(['ns', 'repo']);
    expect(states[0]).toContain('failed:ensureRepository 失败：gitlab down');
  });

  test('failed 项目重跑：先回到 provisioning，本次失败原因才写得回去', async () => {
    const states: string[] = [];
    const failed: ProjectFacts = { ...facts, state: 'failed' };
    const steps: ProvisioningSteps = {
      loadProject: async () => failed,
      ensureNamespace: async () => undefined,
      ensureRepository: async () => { throw new Error('git 缺失'); },
      ensureData: async () => undefined,
      reconcileRoutes: async () => undefined,
      ensureFirstRelease: async () => undefined,
      setProjectState: async (_p, state, message) => { states.push(`${state}${message ? `:${message}` : ''}`); },
    };
    expect(await provisionProjectUseCase(steps, noopLogger)(failed.projectId)).toBe('failed');
    expect(states).toEqual(['provisioning', 'failed:ensureRepository 失败：git 缺失']);
  });

  test('已 active 的项目重跑：步骤幂等，并把残留的失败原因清掉', async () => {
    const states: string[] = [];
    const active: ProjectFacts = { ...facts, state: 'active' };
    const steps: ProvisioningSteps = {
      loadProject: async () => active,
      ensureNamespace: async () => undefined,
      ensureRepository: async () => undefined,
      ensureData: async () => undefined,
      reconcileRoutes: async () => undefined,
      ensureFirstRelease: async () => undefined,
      setProjectState: async (_p, state) => { states.push(state); },
    };
    expect(await provisionProjectUseCase(steps, noopLogger)(active.projectId)).toBe('active');
    // 不带 message 的 active→active：transition 会清掉旧原因。
    expect(states).toEqual(['active']);
  });
});
