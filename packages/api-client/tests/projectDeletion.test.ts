import { expect, test } from 'bun:test';
import { PROJECT_DELETION_PARTICIPANTS, ProjectDeletionOperationSchema, ProjectDeletionPlanSchema } from '@crewstation/contracts';
import { createApiClient } from '../index';

const projectId = '01a0bf5d-8f4b-7178-82e1-9a99060b1192', operationId = '01a0bf5d-8f4b-76c5-866c-f1feda3d63bb', planId = '01a0bf5d-8f4b-7002-9560-94caf593fb19';
const digest = 'a'.repeat(64), timestamp = '2026-09-30T04:00:00.000Z';
const plan = ProjectDeletionPlanSchema.parse({ id: planId, target: { id: projectId, slug: 'weekly-helper', name: '周报助手', namespace: 'cs-weekly-helper', kind: 'DigitalWorker', state: 'active', revision: '3',
  prodHost: 'weekly-helper.apps.cn', previewHost: 'preview.weekly-helper.apps.cn', serviceHost: 'weekly-helper.svc.cn' },
  digest, complete: true, blockers: [], expiresAt: timestamp,
  participants: PROJECT_DELETION_PARTICIPANTS.map((participant) => ({ participant, revision: digest, complete: true, resources: [], references: [], blockers: [] })) });
const operation = ProjectDeletionOperationSchema.parse({ id: operationId, project: { id: projectId, slug: 'weekly-helper', name: '周报助手' }, state: 'accepted', phase: 'seal', confirmationDigest: digest,
  receipts: [], blockers: [], canRetry: true, createdAt: timestamp, updatedAt: timestamp });
const input = { planId, requestKey: operationId, confirm: 'delete' as const };
const reconfirmation = ProjectDeletionPlanSchema.parse({ ...plan, operationId, supersedes: digest });
test('永久删除客户端严格匹配六条路由，202 仍是 accepted，重新确认仍绑定原操作', async () => {
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const client = createApiClient({ baseUrl: 'https://console.test.invalid', fetch: async (raw, init) => {
    const path = new URL(String(raw)).pathname;
    calls.push({ path, method: init!.method!, body: init!.body ? JSON.parse(String(init!.body)) : undefined });
    return Response.json(path.endsWith('/reconfirmation-plans') ? reconfirmation : path.endsWith('/deletion-plans') ? plan : operation, { status: path.endsWith('/deletions') || path.endsWith('/retry') || path.endsWith('/reconfirm') ? 202 : 200 });
  } });
  expect(await client.projectDeletions.prepare(projectId)).toEqual(plan);
  expect((await client.projectDeletions.accept(projectId, input)).state).toBe('accepted');
  expect(await client.projectDeletions.get(operationId)).toEqual(operation);
  expect(await client.projectDeletions.retry(operationId)).toEqual(operation);
  expect(await client.projectDeletions.prepareReconfirmation(operationId)).toEqual(reconfirmation);
  expect(await client.projectDeletions.reconfirm(operationId, input)).toEqual(operation);
  expect(calls).toEqual([
    { path: `/v1/projects/${projectId}/deletion-plans`, method: 'POST', body: {} },
    { path: `/v1/projects/${projectId}/deletions`, method: 'POST', body: input },
    { path: `/v1/project-deletions/${operationId}`, method: 'GET', body: undefined },
    { path: `/v1/project-deletions/${operationId}/retry`, method: 'POST', body: {} },
    { path: `/v1/project-deletions/${operationId}/reconfirmation-plans`, method: 'POST', body: {} },
    { path: `/v1/project-deletions/${operationId}/reconfirm`, method: 'POST', body: input },
  ]);
});
test('ID 编码成单一路径段；来源不完整／伪造完成响应和非法确认不能被客户端接受', async () => {
  const paths: string[] = [];
  const client = createApiClient({ baseUrl: 'https://console.test.invalid', fetch: async (raw) => { paths.push(new URL(String(raw)).pathname); return Response.json({ ...operation, state: 'not-a-state' }); } });
  await expect(client.projectDeletions.get('id/other?force=yes')).rejects.toThrow();
  expect(paths).toEqual(['/v1/project-deletions/id%2Fother%3Fforce%3Dyes']);
  await expect(client.projectDeletions.accept(projectId, { ...input, requestKey: 'unsafe' })).rejects.toThrow();
  expect(paths).toHaveLength(1);
});
test('权限与冲突错误保持 API 错误，不能解释为已受理或已清理', async () => {
  for (const status of [401, 403, 404, 409, 503]) {
    const client = createApiClient({ fetch: async () => Response.json({ error: 'conflict', message: '原清理操作仍在', details: { operationId } }, { status }) });
    await expect(client.projectDeletions.retry(operationId)).rejects.toMatchObject({ status, details: { operationId } });
  }
});
test('重新盘点不能接受首次计划或另一个原操作的材料', async () => {
  for (const response of [plan, { ...reconfirmation, operationId: planId }]) {
    const client = createApiClient({ fetch: async () => Response.json(response) });
    await expect(client.projectDeletions.prepareReconfirmation(operationId)).rejects.toThrow('重新确认计划未绑定请求的原删除操作');
  }
});
