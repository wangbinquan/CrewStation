import type { BuildObservation, RuntimeImageBuildExecutor } from '../ports/buildExecutor';
import { digest } from './runtimeImageFixture';

export function buildExecutorFixture() {
  let state: BuildObservation['state'] = 'running', stopped = false, foreignReceipt = false;
  let gate: Promise<void> | undefined, release: (() => void) | undefined;
  let inspectError: Error | undefined;
  const calls: string[] = [];
  let reconcileStarted = () => {};
  const started = new Promise<void>((resolve) => { reconcileStarted = resolve; });
  const image = { repository: 'registry.test/project/tools', digest, architecture: 'linux/amd64' as const, diffIds: [digest], user: '1000', entrypoint: [], command: [] };
  const executor: RuntimeImageBuildExecutor = {
    reconcile: async (build, _revision, desired) => {
      calls.push(`${desired}:${build.id}:${build.epoch}`);
      reconcileStarted();
      const captured = state;
      if (desired === 'run' && gate) { const wait = gate; gate = undefined; await wait; }
      return { state: desired === 'stop' ? (stopped ? 'stopped' : 'running') : captured, resourceId: build.resourceId!, podUid: 'pod-original',
        ...(captured === 'succeeded' && desired === 'run' ? { receipt: { buildId: build.id, executionEpoch: foreignReceipt ? 999 : build.executionEpoch, podUid: 'pod-original', reference: `${image.repository}@${digest}` } } : {}),
        logs: { cursor: 'first', lines: ['output '.repeat(200)] } };
    },
    inspect: async () => { calls.push('inspect'); if (inspectError) throw inspectError; return { image, base: image }; },
  };
  return { executor, calls, image, started,
    state: (v: BuildObservation['state']) => { state = v; }, stopped: (v: boolean) => { stopped = v; }, foreignReceipt: () => { foreignReceipt = true; },
    inspectionError: (v: Error | undefined) => { inspectError = v; },
    block: () => { gate = new Promise<void>((resolve) => { release = resolve; }); }, unblock: () => { release?.(); },
  };
}
