import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ProjectDeletionLookupSchema, ProjectIdSchema } from '@crewstation/contracts';
import { newId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { deletionFixture } from './deletionFixture';
import type { DeletionFixture } from './deletionFixture';

const available = await testDatabaseAvailable(); let f: DeletionFixture;
beforeAll(async () => { if (available) f = await deletionFixture(); });
afterAll(async () => { await f?.database.drop(); });
describe.skipIf(!available)('按原项目查询永久删除回执（真实 PG）', () => {
  const path = (id: string) => `/v1/projects/${id}/deletion-operation`;
  test('所有查询先核实管理员；没有删除操作时返回空材料，查询不盘点、不入队、不封写', async () => {
    const project = await f.create(), queued = f.queued.length;
    for (const id of [project.id, newId('unknown')]) {
      expect((await f.call(path(id), 'GET', undefined, null)).status).toBe(401);
      expect((await f.call(path(id), 'GET', undefined, { ...f.member, isAdmin: true })).status).toBe(403);
      await expect(f.controller.find({ ...f.member, isAdmin: true }, ProjectIdSchema.parse(id))).rejects.toMatchObject({ kind: 'forbidden' });
    }
    const response = await f.call(path(project.id));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(ProjectDeletionLookupSchema.parse(await response.json())).toEqual({ projectId: project.id, operation: null });
    expect(f.queued).toHaveLength(queued); expect(f.external.calls.filter((c) => c.projectId === project.id)).toEqual([]);
    expect((await f.api.getProject(f.admin, project.id)).state).not.toBe('deleting');
    expect((await f.database.db.execute('SELECT id FROM project.deletion_plans'))).toHaveLength(0);
  });
  test('首次受理回执丢失且计划过期后，原项目查询恢复同一操作，不产生新盘点或队列', async () => {
    const started = await f.start(), queued = f.queued.length;
    f.elapse(600_001);
    const response = await f.call(path(started.value.id));
    expect(ProjectDeletionLookupSchema.parse(await response.json()).operation).toEqual(started.operation);
    expect(await f.controller.find(f.admin, started.value.id)).toEqual(started.operation);
    expect(f.queued).toHaveLength(queued);
    expect(f.external.calls.filter((c) => c.projectId === started.value.id)).toEqual([]);
    expect(await f.controller.accept(f.admin, started.value.id, started.request)).toEqual(started.operation);
  });
  test('彻底清理项目根和计划后仍查到最小原回执，另一个项目不能混入', async () => {
    const started = await f.start(), other = await f.create(); await f.controller.advance(started.operation.id);
    await expect(f.api.getProject(f.admin, started.value.id)).rejects.toMatchObject({ kind: 'not_found' });
    const response = ProjectDeletionLookupSchema.parse(await (await f.call(path(started.value.id))).json());
    expect(response.operation).toMatchObject({ id: started.operation.id, state: 'succeeded', project: { id: started.value.id } });
    expect(await f.controller.find(f.admin, other.id)).toBeUndefined();
    expect((await f.database.db.execute(`SELECT id FROM project.deletion_plans WHERE project_id = '${started.value.id}'`))).toHaveLength(0);
    expect(response.operation).not.toHaveProperty('plan');
  }, 15_000);
});
