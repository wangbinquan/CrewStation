import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RuntimeImageToolCheckSchema } from '@crewstation/contracts';
import { inspectRuntimeDockerfile } from './dockerfilePolicy';

const root = join(import.meta.dir, '../../../deploy/examples/runtime-tools');
test('工具配方可分别继承任务和 Agent 底座，五项工具检查是可消费的严格契约', async () => {
  const dockerfile = await readFile(join(root, 'Dockerfile'), 'utf8');
  for (const usage of ['task', 'agent'] as const) expect(inspectRuntimeDockerfile(dockerfile, { usage, architecture: 'linux/amd64' }).targetIndex).toBe(1);
  const checks = RuntimeImageToolCheckSchema.array().parse(JSON.parse(await readFile(join(root, 'tools.json'), 'utf8')));
  expect(checks.map((check) => check.key)).toEqual(['python.yaml', 'node.cjs', 'node.esm', 'script', 'binary']);
  expect(checks.find((check) => check.key === 'binary')?.expected).toEqual({ kind: 'text', value: 'worker:10001' });
  expect(checks.find((check) => check.key === 'python.yaml')?.argv[0]).toBe('/opt/business-tools/python/bin/python');
  const lock = JSON.parse(await readFile(join(root, 'node/package-lock.json'), 'utf8'));
  expect(lock.packages['node_modules/yaml'].integrity).toMatch(/^sha512-/);
});
