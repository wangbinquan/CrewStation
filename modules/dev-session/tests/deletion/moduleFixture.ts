import type { TaskId } from '@crewstation/contracts';
import type { EnvironmentView } from '../../ports/runtime';
import { createDevSessionModule } from '../../wiring';
import type { DevSessionModuleDeps } from '../../wiring';
import { fakeComputeCatalog } from '../computeFixture';
import { workspaceFixture, workspaceTask } from '../workspaceFixture';
import { developmentWorkFixture } from './workFixture';

/** Actual module and PG; runtime effects and immutable public owners are controlled ports. No physical cleanup is asserted. */
export async function developmentModuleFixture() {
  const f = await developmentWorkFixture(), original = workspaceFixture();
  const workspace = { ...(await original.deps.environments.getEnvironment(workspaceTask))!, id: f.workspace, projectId: f.project, traceId: 'b'.repeat(32) };
  const environments = new Map<TaskId, EnvironmentView>([[workspace.id, workspace]]);
  let effects = 0;
  const dependencies: DevSessionModuleDeps = { ...original.deps, db: f.database.db, deletionWorkSources: f.sources, isAdmin: async () => false,
    environments: { ...original.deps.environments, getEnvironment: async (id: TaskId) => environments.get(id), findDevSession: async () => workspace,
      listRunningDevSessions: async () => [workspace], touch: async () => { effects++; }, createNativeExecution: async (input: Parameters<typeof original.deps.environments.createNativeExecution>[0]) => {
        const current = environments.get(input.id); if (current) return current;
        const env: EnvironmentView = { ...workspace, id: input.id, connected: false, state: 'creating', native: { purpose: input.purpose,
          parentTaskId: input.parentTaskId, agentId: input.agentId, runnerId: input.runnerId, ...(input.terminalId ? { terminalId: input.terminalId } : {}),
          state: 'queued', profile: { name: 'controlled-profile', cpu: '1', memory: '2Gi', storage: '2Gi' } } };
        f.bind('task', input.id); environments.set(input.id, env); effects++; return env;
      } }, compute: fakeComputeCatalog(() => [{ name: 'original', protocol: 'claude-code', isDefault: true }]),
  };
  const create = () => createDevSessionModule(dependencies);
  return { ...f, workspaceEnvironment: workspace, environments, dependencies, create, effects: () => effects };
}
