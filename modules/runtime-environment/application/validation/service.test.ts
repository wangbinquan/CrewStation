import { expect, test } from 'bun:test';
import { newResourceId } from '@crewstation/kernel';
import type { RuntimeImageRegistry } from '../../ports/registry';
import type { RuntimeImageValidationContext } from '../../ports/validationExecutor';
import { validationExecutorWithServices } from './service';

const digest = `sha256:${'a'.repeat(64)}`;
function context(): RuntimeImageValidationContext {
  const id = newResourceId(), versionId = newResourceId(), projectId = newResourceId();
  return {
    validation: { id, versionId, projectId, target: { usage: 'service', command: ['bun', 'server.js'], port: 3000, healthPath: '/health' }, state: 'running', contractDigest: digest, inputDigest: digest, requestKey: 'one', epoch: 1, checks: [], createdBy: newResourceId(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    snapshot: { versionId, image: `registry.test/app@${digest}`, digest, architecture: 'linux/arm64', validationId: id, initializerDigest: digest, initializer: { steps: [], env: {}, secrets: [] }, tools: [], selectionSource: 'request' },
  };
}

test('服务验证只报告仓库产物和启动契约，不伪造运行 imageID 或执行 Runner／生产迁移', async () => {
  const calls: unknown[] = [];
  const registry: RuntimeImageRegistry = { inspect: async (...input) => { calls.push(input); return { repository: 'registry.test/app', digest, architecture: 'linux/arm64', diffIds: [], user: 'app', entrypoint: [], command: ['bun', 'server.js'] }; } };
  const executor = validationExecutorWithServices(registry, 'registry.test', { run: async () => { throw new Error('must not run TaskRunner'); }, stop: async () => { throw new Error('no task environment'); } });
  const input = context(), result = await executor.run(input, async () => true);
  expect(result).toMatchObject({ state: 'passed', verification: 'service-contract' });
  expect(result.observedImageId).toBeUndefined();
  expect(result.checks.map((c) => c.key)).toEqual(['registry-artifact', 'service-startup-contract']);
  expect(calls).toEqual([[input.snapshot.image, 'linux/arm64', { exact: ['app'] }]]);
  expect(await executor.stop(input)).toBe(true);
  await expect(executor.run({ ...input, snapshot: { ...input.snapshot, image: `external.test/app@${digest}` } }, async () => true)).rejects.toThrow('受管仓库');
  await expect(executor.run({ ...input, snapshot: { ...input.snapshot, initializer: { ...input.snapshot.initializer, env: { TOOL_MODE: 'x' } } } }, async () => true)).rejects.toThrow('不使用 Runner');
  expect((await executor.run(input, async () => false)).state).toBe('unknown');
  expect(calls).toHaveLength(1);
});
