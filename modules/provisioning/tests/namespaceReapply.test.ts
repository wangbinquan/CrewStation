import { describe, expect, test } from 'bun:test';
import type { ProjectId, ServiceId } from '@crewstation/contracts';
import { noopLogger } from '@crewstation/kernel';
import { reapplyNamespacesUseCase } from '../application/reapplyNamespaces';
import { namespaceReapplyTask } from '../workers/namespaceReapply';
import type { ProjectFacts, ProvisioningSteps } from '../api/steps';

const facts = (slug: string, kind: ProjectFacts['kind'] = 'DigitalWorker'): ProjectFacts => ({
  projectId: `01a0bf5d-8f4b-7178-82e1-9a99060b11${slug.length}0` as ProjectId, state: 'active',
  serviceId: '01a0bf5d-8f4b-76c5-866c-f1feda3d63bb' as ServiceId,
  slug, name: slug, namespace: `cs-${slug}`, kind, template: '01a0bf5d-8f4b-7002-9560-94caf593fb19',
});

/** 重下发只碰命名空间：其余开通步骤与项目状态都不该被调用。 */
function steps(projects: readonly ProjectFacts[], calls: string[], failOn: readonly string[] = []): ProvisioningSteps {
  const forbidden = (step: string) => async () => { calls.push(`FORBIDDEN:${step}`); };
  return {
    loadProject: async () => undefined,
    listProjects: async () => [...projects],
    ensureNamespace: async (f) => { calls.push(f.namespace); if (failOn.includes(f.namespace)) throw new Error(`apply 被拒：${f.namespace}`); },
    ensureRepository: forbidden('repo'), ensureData: forbidden('data'), reconcileRoutes: forbidden('routes'), ensureFirstRelease: forbidden('release'),
    setProjectState: async () => { calls.push('FORBIDDEN:state'); },
  };
}

describe('启动重下发命名空间（RFC-018）', () => {
  test('遍历全部项目，只跑 ensureNamespace，不动状态与其余步骤', async () => {
    const calls: string[] = [];
    const outcome = await reapplyNamespacesUseCase(steps([facts('alpha'), facts('proxy', 'APIProxy')], calls), noopLogger)();
    expect(calls).toEqual(['cs-alpha', 'cs-proxy']);
    expect(outcome).toEqual({ applied: 2, failed: 0 });
  });

  test('单个命名空间失败不影响其余项目，计入 failed', async () => {
    const calls: string[] = [];
    const outcome = await reapplyNamespacesUseCase(steps([facts('alpha'), facts('beta'), facts('gamma')], calls, ['cs-beta']), noopLogger)();
    expect(calls).toEqual(['cs-alpha', 'cs-beta', 'cs-gamma']);
    expect(outcome).toEqual({ applied: 2, failed: 1 });
  });

  test('没有项目时是空转，不抛错', async () => {
    const calls: string[] = [];
    expect(await reapplyNamespacesUseCase(steps([], calls), noopLogger)()).toEqual({ applied: 0, failed: 0 });
    expect(calls).toEqual([]);
  });

  test('启动任务只跑一轮，stop 等它结束；listProjects 抛错也不会把异常抛回进程启动', async () => {
    let runs = 0, release = (): void => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const task = namespaceReapplyTask(async () => { runs += 1; await gate; return { applied: 1, failed: 0 }; }, noopLogger);
    task.start(); task.start();
    expect(runs).toBe(1);
    release();
    await task.stop();
    expect(runs).toBe(1);

    const failing = namespaceReapplyTask(async () => { throw new Error('目录读取失败'); }, noopLogger);
    expect(() => { failing.start(); }).not.toThrow();
    await failing.stop();
  });
});
