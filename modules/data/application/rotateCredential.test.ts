import { expect, test } from 'bun:test';
import type { Actor } from '@crewstation/contracts';
import { noopLogger } from '@crewstation/kernel';
import type { DataUseCaseDeps } from './dependencies';
import { rotateCredentialUseCase } from './rotateCredential';

const admin = { isAdmin: true, userId: 'admin' } as Actor;
test('轮换只给管理员，拒绝不存在、未就绪和未配置；结果不带口令', async () => {
  const calls: unknown[] = [];
  let row: unknown = undefined;
  const deps = { resources: { getById: async () => row }, logger: noopLogger, provisioning: { credentials: { rotateCredential: async (...args: unknown[]) => { calls.push(args); } } } } as unknown as DataUseCaseDeps;
  const rotate = rotateCredentialUseCase(deps);
  await expect(rotate({ ...admin, isAdmin: false }, 'db')).rejects.toThrow('只有管理员');
  await expect(rotate(admin, 'db')).rejects.toThrow('数据资源');
  row = { id: 'db', projectId: 'project', kind: 'postgres', state: 'failed' };
  await expect(rotate(admin, 'db')).rejects.toThrow('已就绪');
  row = { id: 'db', projectId: 'project', kind: 'postgres', state: 'ready', env: 'production', plan: 'small', envVar: 'CS_DATABASE_URL', createdAt: new Date(), secretBox: 'encrypted-old' };
  const { provisioning: _omit, ...unconfigured } = deps;
  await expect(rotateCredentialUseCase(unconfigured)(admin, 'db')).rejects.toThrow('尚未启用');
  expect(await rotate(admin, 'db')).toMatchObject({ id: 'db', state: 'ready' });
  expect(calls).toEqual([['db', 'project']]);
  expect(JSON.stringify(await rotate(admin, 'db'))).not.toContain('secret');
});
