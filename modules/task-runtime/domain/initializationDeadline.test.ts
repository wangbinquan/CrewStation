import { expect, test } from 'bun:test';
import { withInitializationDeadline } from './initializationDeadline';
import type { WorkloadRender } from './taskEnvironment';

const render: WorkloadRender = { image: 'image', workerUid: 10001, start: 1, resources: { cpu: '1', memory: '1Gi', storage: '1Gi' } };
test('只有显式镜像需要初始化期限；期限包含步骤和检查预算，同代次重连不续期，新代次重新开始', () => {
  const now = new Date('2026-09-27T00:00:00Z');
  expect(withInitializationDeadline(render, now)).toBe(render);
  const selected: WorkloadRender = { ...render, runtimeImage: { versionId: 'version', image: 'image', digest: `sha256:${'a'.repeat(64)}`, architecture: 'linux/amd64', validationId: 'validation', initializerDigest: `sha256:${'b'.repeat(64)}`, selectionSource: 'request', initializer: { steps: [{ id: 'setup', argv: ['setup'], cwd: '/work', timeoutSeconds: 30 }], env: {}, secrets: [] }, tools: [{ key: 'tool', argv: ['tool'], cwd: '/work', timeoutSeconds: 10, expected: { kind: 'text', value: 'ok' } }] } };
  const first = withInitializationDeadline(selected, now);
  expect(first.runtimeInitializationDeadline).toEqual({ generation: 1, at: '2026-09-27T00:01:40.000Z' });
  expect(withInitializationDeadline(first, new Date(now.getTime() + 60_000))).toBe(first);
  expect(withInitializationDeadline({ ...first, start: 2 }, new Date(now.getTime() + 60_000)).runtimeInitializationDeadline).toEqual({ generation: 2, at: '2026-09-27T00:02:40.000Z' });
});
