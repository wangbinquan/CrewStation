import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { BusinessControlDto, BusinessTaskV3Dto, RuntimeImageExecutionSnapshot } from '@crewstation/contracts';
import { newResourceId, precondition } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import type { BusinessRuntimeImages } from '../ports/runtimeImages';
import { executionHttpFixture } from './executionHttpFixture';

const available = await testDatabaseAvailable(), root = '/v3/business-tasks', control = '/v3/business-execution/control';
function snapshot(versionId: string): RuntimeImageExecutionSnapshot {
  const digest = `sha256:${'a'.repeat(64)}`;
  return { versionId, image: `registry.test/task@${digest}`, digest, architecture: 'linux/amd64', initializer: { steps: [], env: {}, secrets: [] }, tools: [], initializerDigest: digest, validationId: newResourceId(), selectionSource: 'request' };
}
describe.skipIf(!available)('RFC-028 业务父任务独立镜像', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  async function fixture(missing = false) {
    const defaultVersion = newResourceId(), explicitVersion = newResourceId(), selected = snapshot(explicitVersion);
    const reservations: Array<Parameters<BusinessRuntimeImages['reserveTask']>> = [], confirmations: string[] = [];
    const port: BusinessRuntimeImages = {
      reserveTask: async (...args) => {
        reservations.push(args); const [, , selection, requested] = args;
        if (requested && requested !== selection.runtimeImageVersionId && !selection.allowedRuntimeImageVersionIds?.includes(requested)) throw precondition('镜像不在任务允许集合');
        return { ...selected, versionId: requested ?? selection.runtimeImageVersionId!, selectionSource: requested ? 'request' : 'configuration' };
      },
      confirmTask: async (image, id) => { confirmations.push(`${id}:${image.versionId}`); },
    };
    const f = await executionHttpFixture(tdb.db, { port: missing ? undefined : port, selection: { runtimeImageVersionId: defaultVersion, allowedRuntimeImageVersionIds: [explicitVersion] } });
    const instanceId = newResourceId(), lease = await (await f.request(`${control}/claim`, { instanceId })).json() as BusinessControlDto;
    expect((await f.request(`${control}/activate`, { instanceId, expectedEpoch: lease.epoch, leaseId: lease.leaseId, preparationDigest: 'a'.repeat(64) })).status).toBe(200);
    return { ...f, port, defaultVersion, explicitVersion, reservations, confirmations, body: { requestKey: newResourceId(), taskContractVersion: 'v1', fence: { instanceId, epoch: lease.epoch, leaseId: lease.leaseId } } };
  }
  test('并发同键只保留胜出的父任务镜像引用', async () => {
    const f = await fixture(), reserve = f.port.reserveTask, released: string[] = [];
    let open!: () => void; const gate = new Promise<void>((resolve) => { open = resolve; });
    f.port.reserveTask = async (...args) => { const snapshot = await reserve(...args); if (f.reservations.length === 3) open(); await gate; return snapshot; };
    f.port.release = async (_snapshot, owner) => { released.push(owner.id); };
    const responses = await Promise.all(Array.from({ length: 3 }, () => f.request(root, f.body)));
    expect(responses.every((r) => r.status < 300)).toBe(true);
    const tasks = await Promise.all(responses.map((r) => r.json() as Promise<BusinessTaskV3Dto>));
    expect(new Set(tasks.map((task) => task.id)).size).toBe(1);
    expect(new Set(released)).toEqual(new Set(f.reservations.map((entry) => entry[1]).filter((id) => id !== tasks[0]!.id)));
    expect(released).toHaveLength(2);
  });
  test('请求覆盖使用自己的 release 允许集合，固定快照传入任务容器，重复键不重新解析', async () => {
    const f = await fixture(), body = { ...f.body, runtimeImageVersionId: f.explicitVersion };
    const first = await f.request(root, body); expect(first.status).toBe(201);
    const task = await first.json() as BusinessTaskV3Dto;
    expect(task.runtimeImage).toMatchObject({ versionId: f.explicitVersion, selectionSource: 'request' });
    expect(f.environmentInputs[0]!.runtimeImage).toEqual(task.runtimeImage);
    expect(f.reservations[0]).toEqual([f.projectId, task.id, { runtimeImageVersionId: f.defaultVersion, allowedRuntimeImageVersionIds: [f.explicitVersion] }, f.explicitVersion]);
    expect(f.confirmations).toEqual([`${task.id}:${f.explicitVersion}`]);
    expect((await f.make().request(root, body)).status).toBe(200); expect(f.reservations).toHaveLength(1);
    expect((await f.request(root, { ...body, runtimeImageVersionId: f.defaultVersion })).status).toBe(409);
  });
  test('容量重试保留原选择；无请求用任务默认；非法选择不创建容器', async () => {
    const f = await fixture(); f.behavior.quota = true;
    expect((await f.request(root, f.body)).status).toBe(429); expect(f.reservations).toHaveLength(1);
    f.behavior.quota = false;
    const retried = await f.make().request(root, f.body); expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({ runtimeImage: { versionId: f.defaultVersion, selectionSource: 'configuration' } });
    expect(f.reservations).toHaveLength(1);
    const before = f.behavior.starts;
    expect((await f.request(root, { ...f.body, requestKey: newResourceId(), runtimeImageVersionId: newResourceId() })).status).toBe(412);
    expect(f.behavior.starts).toBe(before);
  });
  test('缺镜像端口不能静默使用平台镜像，命令子任务不接收换镜像字段', async () => {
    const f = await fixture(true);
    expect((await f.request(root, f.body)).status).toBe(412); expect(f.behavior.starts).toBe(0);
    const response = await f.request(`${root}/${newResourceId()}/subtasks`, { ...f.body, taskContractVersion: undefined, kind: 'command', name: 'check', argv: ['pwd'], runtimeImageVersionId: f.explicitVersion });
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ details: { code: 'unknown_field' } });
  });
});
