import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import type { BusinessTaskDto, ServiceActor, SubmitSubtaskRequest, SubtaskDto, SubtaskId, TaskId } from '@crewstation/contracts';
import { BusinessTaskDtoSchema, IDENTITY_HEADERS, SubtaskDtoSchema } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { newId } from '@crewstation/kernel';
import type { BusinessTaskModuleApi } from '../api/moduleApi';
import { serviceRoutes } from '../http/serviceRoutes';

/**
 * 业务以服务身份调用的 API 面。它和约定表一样是「已部署的业务依赖、平台单方面改动就会弄坏」的东西，
 * 但路径写在路由里而不在 contracts 里，所以在这里锁：删路由、改路径，这张表必须跟着动，而且动得让人看见。
 */
const SERVICE_API = [
  'GET /v1/business-tasks/:taskId',
  'GET /v1/business-tasks/:taskId/subtasks',
  'GET /v1/business-tasks/:taskId/subtasks/:subtaskId',
  'GET /v1/business-tasks/:taskId/subtasks/:subtaskId/output',
  'POST /v1/business-tasks',
  'POST /v1/business-tasks/:taskId/close',
  'POST /v1/business-tasks/:taskId/pause',
  'POST /v1/business-tasks/:taskId/resume',
  'POST /v1/business-tasks/:taskId/subtasks',
  'POST /v1/business-tasks/:taskId/subtasks/:subtaskId/cancel',
  'POST /v1/business-tasks/:taskId/subtasks/:subtaskId/messages',
  'POST /v1/business-tasks/:taskId/subtasks/:subtaskId/retry',
];

const taskId = newId('tsk') as TaskId;
const subtaskId = newId('sub') as SubtaskId;
const now = '2026-09-20T00:00:00.000Z';
// 夹具先过契约 Schema：夹具写错应当错在夹具上，而不是错在后面的断言上。
const task = (state: BusinessTaskDto['state']): BusinessTaskDto => BusinessTaskDtoSchema.parse({
  id: taskId, serviceId: newId('svc'), state, traceId: 'a'.repeat(32), volumeMode: 'follow-container', profile: 'standard', labels: {}, createdAt: now,
});
const subtask = (state: SubtaskDto['state']): SubtaskDto => SubtaskDtoSchema.parse({
  id: subtaskId, taskId, name: 'chat', kind: 'agent', mode: 'oneshot', state, attempt: 1, agentProfile: 'chat-v1',
});

interface Recorded { readonly call: string; readonly caller: ServiceActor; readonly input?: unknown }

function recordingApi(calls: Recorded[]): BusinessTaskModuleApi {
  let polls = 0;
  const api: Partial<BusinessTaskModuleApi> = {
    createTask: async (caller, input) => { calls.push({ call: 'createTask', caller, input }); return task('running'); },
    submitSubtask: async (caller, _task, input: SubmitSubtaskRequest) => { calls.push({ call: 'submitSubtask', caller, input }); return subtask('pending'); },
    getSubtask: async (caller) => { calls.push({ call: 'getSubtask', caller }); polls += 1; return subtask(polls < 2 ? 'running' : 'succeeded'); },
    subtaskOutput: async (caller) => { calls.push({ call: 'subtaskOutput', caller }); return '你好，我是样例 Agent'; },
    closeTask: async (caller) => { calls.push({ call: 'closeTask', caller }); return task('closed'); },
  };
  return api as BusinessTaskModuleApi;
}

interface TemplateAgentClient {
  runChat(prompt: string, options: { baseUrl: string; traceId?: string; fetch: (input: string, init?: RequestInit) => Promise<Response>; sleep: (ms: number) => Promise<void> }): Promise<{ taskId: string; subtaskId: string; state: string; text: string }>;
}

describe('业务任务的服务域 API 面', () => {
  test('路由清单与锁定的 API 面一致', () => {
    const routes = serviceRoutes({} as BusinessTaskModuleApi).routes.map((route) => `${route.method} ${route.path}`);
    expect([...new Set(routes)].sort()).toEqual(SERVICE_API);
  });

  // 消费者驱动：最小样例是每个新项目的起点，它的调用代码是手写的、不 import 任何平台包。
  // 平台改了路径、请求字段或它读取的响应字段，平台自己的用例可以全绿，坏的是所有用模板建出来的数字人。
  // 这里让模板**自己的**客户端代码去打**真实的**路由与请求 Schema。
  test('最小样例的对话客户端原样跑通真实路由：创建 → 提交 → 轮询 → 读输出 → 关闭', async () => {
    const calls: Recorded[] = [];
    const app = createApp({ name: 'business-task-surface' });
    app.route('/', serviceRoutes(recordingApi(calls)));
    const template = (await import(resolve(import.meta.dir, '..', '..', '..', 'templates', 'minimal-sample', 'src', 'platform', 'agentClient.ts'))) as TemplateAgentClient;

    const result = await template.runChat('你好', {
      baseUrl: 'http://api.svc.cs.internal',
      // 网关按源 Pod IP 解析调用方并注入来源服务头；业务代码自己不带任何凭据。
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set(IDENTITY_HEADERS.sourceService, 'demo/demo');
        return app.fetch(new Request(input, { ...init, headers }));
      },
      sleep: async () => {},
    });

    expect(result).toMatchObject({ taskId, subtaskId, state: 'succeeded', text: '你好，我是样例 Agent' });
    expect(calls.map((entry) => entry.call)).toEqual(['createTask', 'submitSubtask', 'getSubtask', 'getSubtask', 'subtaskOutput', 'closeTask']);
    expect(calls.every((entry) => entry.caller.identity === 'demo/demo' && entry.caller.project === 'demo')).toBe(true);
    // 请求体过的是真实的 SubmitSubtaskRequestSchema：模板引用的档案名与模式原样到达用例层。
    expect(calls[1]?.input).toMatchObject({ kind: 'agent', name: 'chat', agentProfile: 'chat-v1', mode: 'oneshot', prompt: '你好' });
  });

  test('不带来源服务身份的请求被拒绝，用例层不被触达', async () => {
    const calls: Recorded[] = [];
    const app = createApp({ name: 'business-task-surface' });
    app.route('/', serviceRoutes(recordingApi(calls)));
    const response = await app.fetch(new Request('http://api.svc.cs.internal/v1/business-tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
    expect(response.status).toBe(401);
    expect(calls).toEqual([]);
  });
});
