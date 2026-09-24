import { describe, expect, test } from 'bun:test';
import type { ProjectId, ServiceId, TaskId, UserId } from '@crewstation/contracts';
import type { DataResource } from './dataResource';
import { bindingProjection, databaseProjection } from './dataRecords';
import type { TaskDataBinding } from './taskDataBinding';

const at = new Date('2026-09-24T00:00:00Z');
const resource = (over: Partial<DataResource> = {}): DataResource => ({
  id: '01a0bf5d-8f4b-7c01-8e19-e226732a75a1', projectId: '01a0bf5d-8f4b-7178-82e1-9a99060b1192' as ProjectId, serviceId: '01a0bf5d-8f4b-76c5-866c-f1feda3d63bb' as ServiceId,
  kind: 'postgres', env: 'production', plan: 'db-small', state: 'ready', envVar: 'CS_DATABASE_URL', objectName: 'cs_demo', secretBox: 'boxed', createdAt: at, updatedAt: at, ...over,
});
const binding = (over: Partial<TaskDataBinding> = {}): TaskDataBinding => ({
  id: '01a0bf5d-8f4b-7c01-8e19-e226732a75b2', taskId: '01a0bf5d-8f4b-7418-8a3f-7cbb4a1fd751' as TaskId, serviceId: 'svc', projectId: '01a0bf5d-8f4b-7178-82e1-9a99060b1192',
  mode: 'diagnostic-readonly', state: 'requested', requestedBy: '01a0bf5d-8f4b-7793-867c-efd7527b386b' as UserId, ttlMinutes: 30, createdAt: at, updatedAt: at, ...over,
});

describe('数据资源与访问绑定的期望（RFC-025 第四期）', () => {
  test('数据库：记录 ID 沿用数据资源；子对象是库与同名角色；展示环境、库名、套餐与变量名；连接串不进台账', () => {
    const source = resource();
    const projection = databaseProjection(source)!;
    expect(projection.release).toBeUndefined();
    expect(projection.declaration).toEqual({
      id: source.id, kind: 'database', ref: source.id, projectId: source.projectId,
      spec: { children: [{ kind: 'PostgresDatabase', name: 'cs_demo' }, { kind: 'PostgresRole', name: 'cs_demo' }], engine: 'postgres', env: 'production', plan: 'db-small' },
      display: { env: 'production', database: 'cs_demo', plan: 'db-small', envVar: 'CS_DATABASE_URL' },
      conditions: [{ type: 'Failed', status: 'false' }],
    });
    expect(JSON.stringify(projection)).not.toContain('boxed');
  });

  test('数据库：供给失败报 Failed（带原因）；释放中与已释放受理释放；不供给的种类不投影', () => {
    expect(databaseProjection(resource({ state: 'failed', message: 'CREATE DATABASE 被拒' }))!.declaration.conditions).toEqual([{ type: 'Failed', status: 'true', reason: 'provisioning-failed', message: 'CREATE DATABASE 被拒' }]);
    expect(databaseProjection(resource({ state: 'failed' }))!.declaration.conditions[0]?.message).toBe('数据库供给失败');
    expect(databaseProjection(resource({ state: 'released' }))!.release).toEqual({ code: 'released', message: '数据资源已释放' });
    expect(databaseProjection(resource({ state: 'releasing' }))!.release?.code).toBe('released');
    expect(databaseProjection(resource({ kind: 's3' }))).toBeUndefined();
  });

  test('绑定：等批准排队；生效后子对象是临时角色、带到期时间；开发模式没有数据面对象；挂在会话下', () => {
    const requested = bindingProjection(binding()).declaration;
    expect(requested.parentId).toBe('01a0bf5d-8f4b-7418-8a3f-7cbb4a1fd751');
    expect(requested.spec.children).toEqual([]);
    expect(requested.conditions).toEqual([{ type: 'Prepared', status: 'false', reason: 'awaiting-approval', message: '等负责人批准' }]);
    const expiresAt = new Date('2026-09-24T00:30:00Z');
    const active = bindingProjection(binding({ state: 'active', roleName: 'cs_t_abc', secretBox: 'boxed', expiresAt }), { database: 'cs_demo', ownerRole: 'cs_demo' }).declaration;
    expect(active.spec).toEqual({ children: [{ kind: 'PostgresRole', name: 'cs_t_abc' }], mode: 'diagnostic-readonly', ttlMinutes: 30, expiresAt: '2026-09-24T00:30:00.000Z', database: 'cs_demo', ownerRole: 'cs_demo' });
    // 还没有临时角色（等批准）或不知道生产库时，期望里不写库名。
    expect(bindingProjection(binding(), { database: 'cs_demo', ownerRole: 'cs_demo' }).declaration.spec).not.toHaveProperty('database');
    expect(bindingProjection(binding({ state: 'active', roleName: 'cs_t_abc' })).declaration.spec).not.toHaveProperty('database');
    expect(active.conditions).toEqual([{ type: 'Prepared', status: 'true' }, { type: 'Granted', status: 'true' }]);
    expect(active.display).toEqual({ mode: 'diagnostic-readonly', expiresAt: '2026-09-24T00:30:00.000Z' });
    expect(JSON.stringify(active)).not.toContain('boxed');
    expect(bindingProjection(binding({ state: 'approved' })).declaration.conditions).toContainEqual({ type: 'Granted', status: 'false' });
    expect(bindingProjection(binding({ mode: 'development', state: 'active', roleName: 'development' }), { database: 'cs_demo', ownerRole: 'cs_demo' }).declaration.spec).toEqual({ children: [], mode: 'development', ttlMinutes: 30 });
  });

  test('绑定：拒绝、收回、到期都受理释放，原因照结束的方式', () => {
    expect(bindingProjection(binding({ state: 'rejected' })).release).toEqual({ code: 'rejected', message: '负责人已拒绝' });
    expect(bindingProjection(binding({ state: 'revoked', roleName: 'cs_t_abc' })).release).toEqual({ code: 'revoked', message: '已收回' });
    expect(bindingProjection(binding({ state: 'expired', roleName: 'cs_t_abc' })).release).toEqual({ code: 'expired', message: '已到期' });
    expect(bindingProjection(binding({ state: 'active' })).release).toBeUndefined();
  });
});
