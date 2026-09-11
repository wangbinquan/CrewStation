import { describe, expect, test } from 'bun:test';
import type { ProjectId, ServiceId } from '@crewstation/contracts';
import { noopLogger } from '@crewstation/kernel';
import { provisionProjectUseCase } from '../application/provisionProject';
import type { ProjectFacts, ProvisioningSteps } from '../api/steps';

const facts: ProjectFacts = { projectId: 'prj_0123456789abcdef0123456789abcdef' as ProjectId, serviceId: 'svc_0123456789abcdef0123456789abcdef' as ServiceId, slug: 'demo', name: 'demo', namespace: 'cs-demo', kind: 'DigitalWorker', template: 'minimal-sample' };

describe('provisioning', () => {
  test('按顺序执行各步并推进 active；某步失败则记 failed 并停止', async () => {
    const calls: string[] = [];
    const states: string[] = [];
    const make = (failAt?: string): ProvisioningSteps => ({
      loadProject: async () => facts,
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
});
