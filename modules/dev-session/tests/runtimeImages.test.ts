import { expect, test } from 'bun:test';
import type { RuntimeImageExecutionSnapshot, TaskId } from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { createApp } from '@crewstation/http';
import { sessionLifecycleUseCases } from '../application/sessionLifecycle';
import { clusterNativeUseCases } from '../application/nativeTerminals';
import { devSessionRoutes } from '../http/devSessionRoutes';
import { nativeTerminalRoutes } from '../http/nativeTerminalRoutes';
import type { DevSessionModuleApi } from '../api/moduleApi';
import type { DevelopmentRuntimeImages } from '../ports/runtimeImages';
import { isolatedNativeFixture } from './isolatedNativeFixture';
import { agentExecutionFixture } from './agentExecutionFixture';
import { fakeComputeCatalog } from './computeFixture';
import { workspaceActor, workspaceFixture, workspaceProject, workspaceTask } from './workspaceFixture';

const snapshot = (): RuntimeImageExecutionSnapshot => ({ versionId: newResourceId(), image: `registry/task@sha256:${'a'.repeat(64)}`, digest: `sha256:${'a'.repeat(64)}`, architecture: 'linux/amd64', initializerDigest: `sha256:${'b'.repeat(64)}`, validationId: newResourceId(), initializer: { steps: [], env: {}, secrets: [] }, tools: [], selectionSource: 'request' });
function images(image = snapshot()) {
  const requests: Array<Parameters<DevelopmentRuntimeImages['reserve']>> = [], confirmations: unknown[] = [], restores: unknown[] = [];
  const port: DevelopmentRuntimeImages = { reserve: async (...args) => { requests.push(args); return image; }, confirm: async (...args) => { confirmations.push(args); }, restore: async (...args) => { restores.push(args); } };
  return { image, port, requests, confirmations, restores };
}

test('工作区在创建前独立预留镜像，固定环境身份并回显实际快照', async () => {
  const f = workspaceFixture(), i = images();
  f.deps.runtimeImages = i.port; f.state.missing = true;
  const base = (await f.deps.environments.getEnvironment(workspaceTask))!;
  const created: unknown[] = [];
  f.deps.environments.createEnvironment = async (input) => { created.push(input); return { ...base, id: input.runtimeImageTaskId!, runtimeImage: input.runtimeImage }; };
  const opened = await sessionLifecycleUseCases(f.deps).openSession(workspaceActor, workspaceProject, { branch: 'main', runtimeImageVersionId: i.image.versionId });
  expect(created).toHaveLength(1);
  expect(created[0]).toMatchObject({ runtimeImageTaskId: opened.taskId, runtimeImage: i.image });
  expect(i.requests[0]?.slice(1)).toEqual([workspaceProject, { type: 'session', id: opened.taskId }, i.image.versionId, undefined]);
  expect(i.confirmations).toEqual([[i.image, { type: 'session', id: opened.taskId }]]);
  expect(opened.runtimeImage).toEqual(i.image);
});

test('Agent 使用自己的档位和镜像，CLI 重试拒绝更换镜像，重开保持快照', async () => {
  const f = agentExecutionFixture(), i = images();
  f.deps.runtimeImages = i.port;
  f.deps.compute = fakeComputeCatalog(() => [{ name: 'image-agent', protocol: 'opencode', model: 'm', isDefault: true }]);
  const agent = await f.api.startAgent(workspaceActor, workspaceTask, { prompt: 'hello', runtimeImageVersionId: i.image.versionId });
  expect(f.inputs[0]).toMatchObject({ runtimeImage: i.image, image: i.image.image });
  expect(agent.runtimeImage).toEqual(i.image);
  expect(agent.image).toBe(i.image.image);
  expect(i.requests[0]?.[4]).toEqual(f.inputs[0]?.computeProfile);
  const cli = isolatedNativeFixture(), c = images(); cli.deps.runtimeImages = c.port;
  const request = { ...cli.input(), runtimeImageVersionId: c.image.versionId };
  const terminal = await cli.api.startNativeTerminal(workspaceActor, workspaceTask, request);
  expect(terminal.runtimeImage).toEqual(c.image);
  expect(terminal.image).toBe(c.image.image);
  await cli.run(terminal);
  await expect(cli.api.startNativeTerminal(workspaceActor, workspaceTask, { ...request, runtimeImageVersionId: newResourceId() })).rejects.toMatchObject({ kind: 'conflict' });
  expect(c.requests).toHaveLength(1);
  const restart = await clusterNativeUseCases(cli.deps, cli.repository).manageClusterNative({ ...workspaceActor, isAdmin: true }, terminal.execution!.taskId, true, crypto.randomUUID());
  await cli.api.dispatchPendingNativeExecution(restart.operationId as TaskId);
  expect(c.restores).toEqual([[workspaceProject, c.image, terminal.execution!.taskId, restart.operationId]]);
  expect((await cli.repository.findExecution(restart.operationId as TaskId))?.execution?.runtimeImage).toEqual(c.image);
});

test('严格 v2 HTTP 三个入口保留选择并拒绝未知字段，不配置能力时显式失败', async () => {
  const calls: unknown[] = [], f = workspaceFixture(), i = images();
  const api = {
    openSession: async (...args: unknown[]) => { calls.push(args); return { taskId: workspaceTask }; },
    startAgent: async (...args: unknown[]) => { calls.push(args); return { agentId: newResourceId() }; },
    startNativeTerminal: async (...args: unknown[]) => { calls.push(args); return { agentId: newResourceId() }; },
  } as unknown as DevSessionModuleApi;
  const app = createApp({ name: 'image-selection-test' }); app.route('/', devSessionRoutes(api, async () => false)); app.route('/', nativeTerminalRoutes(api, async () => false));
  const inputs = [
    [`/v2/projects/${workspaceProject}/dev-session`, { branch: 'main' }, 201],
    [`/v2/tasks/${workspaceTask}/agents`, { prompt: 'hello' }, 201],
    [`/v2/tasks/${workspaceTask}/agent-terminals`, { clientRequestId: crypto.randomUUID(), cols: 80, rows: 24 }, 202],
  ] as const;
  for (const [url, body, status] of inputs) {
    const request = { ...body, runtimeImageVersionId: i.image.versionId };
    const post = (body: unknown) => app.request(url, { method: 'POST', headers: { [IDENTITY_HEADERS.userId]: workspaceActor.userId, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect((await post(request)).status).toBe(status);
    expect((await post({ ...request, unknown: 'reject' })).status).toBe(400);
    expect(calls.at(-1)).toEqual([workspaceActor, url.includes('/projects/') ? workspaceProject : workspaceTask, request]);
  }
  f.state.missing = true;
  await expect(sessionLifecycleUseCases(f.deps).openSession(workspaceActor, workspaceProject, { branch: 'main', runtimeImageVersionId: i.image.versionId })).rejects.toThrow('尚未配置');
});
