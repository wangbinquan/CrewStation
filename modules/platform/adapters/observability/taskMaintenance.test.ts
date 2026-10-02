import { expect, test } from 'bun:test';
import type { TaskMaintenanceHandler, TaskMaintenanceSnapshot, TaskMaintenanceRuntime } from '../../ports/taskMaintenance';
import { ProjectIdSchema } from '@crewstation/contracts';
import { bindTaskMaintenance } from './taskMaintenance';

const id = Bun.randomUUIDv7();
const snapshot: TaskMaintenanceSnapshot = { id, projectId: ProjectIdSchema.parse(Bun.randomUUIDv7()), owner: { module: 'task-runtime', ref: id },
  kind: 'agent-execution', generation: 1, version: 7, retainUntil: null, phaseSince: new Date().toISOString(), specHash: 'a'.repeat(64) };
function registry() {
  let handler: TaskMaintenanceHandler;
  return { registerMaintenanceEndingHandler: (owner: string, actual: TaskMaintenanceHandler) => { expect(owner).toBe('task-runtime'); handler = actual; },
    run: () => handler('compaction', snapshot) };
}

test('the composition forwards the exact step and snapshot and preserves runtime API identity', async () => {
  const resources = registry(), runtime: TaskMaintenanceRuntime = { inspectResourceEnding: async (step, actual) => {
    expect(step).toBe('compaction'); expect(actual).toBe(snapshot); return { status: 'permitted', snapshot: actual };
  } };
  expect(bindTaskMaintenance(resources, runtime)).toBe(runtime);
  expect(await resources.run()).toEqual({ status: 'permitted', snapshot });
});
test('an unavailable owner capability waits instead of claiming legacy permission', async () => {
  const resources = registry(), runtime: TaskMaintenanceRuntime = {};
  expect(bindTaskMaintenance(resources, runtime)).toBe(runtime);
  expect(await resources.run()).toEqual({ status: 'waiting', reason: 'task-ending-handler-unavailable' });
});
