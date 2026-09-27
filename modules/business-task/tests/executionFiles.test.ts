import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { BusinessControlDto, BusinessTaskV3Dto, RunnerCommand } from '@crewstation/contracts';
import { newResourceId, PlatformError } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import { executionHttpFixture } from './executionHttpFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-027 文件 API 归属与暂停边界', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  const active = async () => {
    const f = await executionHttpFixture(tdb.db), instanceId = newResourceId(), control = '/v3/business-execution/control';
    const lease = await (await f.request(`${control}/claim`, { instanceId })).json() as BusinessControlDto;
    const fence = { epoch: lease.epoch, leaseId: lease.leaseId!, instanceId };
    expect((await f.request(`${control}/activate`, { expectedEpoch: fence.epoch, leaseId: fence.leaseId, instanceId, preparationDigest: 'a'.repeat(64) })).status).toBe(200);
    const response = await f.request('/v3/business-tasks', { requestKey: 'file-task', taskContractVersion: 'v1', fence });
    expect(response.status).toBe(201);
    const task = await response.json() as BusinessTaskV3Dto, env = f.environments.get(task.id)!;
    env.state = 'running'; env.connected = true;
    return { ...f, task, env, fence };
  };

  test('reads validate ownership and payload, forward bounded queries and work without an active execution lease', async () => {
    const f = await active(), commands: RunnerCommand[] = [], path = `/v3/business-tasks/${f.task.id}`;
    f.runner.sendCommand = async (id, command) => {
      expect(id).toBe(f.task.id); commands.push(command);
      if (command.type === 'readBusinessFile') return { path: command.query.path, version: 'a'.repeat(64), size: 3, offset: 0, contentBase64: 'YWJj', nextOffset: null };
      return { path: '.', entries: [{ name: 'file', kind: 'file', size: 3, modifiedAt: new Date().toISOString() }], nextCursor: null };
    };
    expect((await f.request('/v3/business-execution/control/release', { expectedEpoch: f.fence.epoch, leaseId: f.fence.leaseId, instanceId: f.fence.instanceId })).status).toBe(200);
    const read = await f.request(`${path}/file?path=result.bin&limit=3`);
    expect(read.status).toBe(200); expect(await read.json()).toMatchObject({ contentBase64: 'YWJj', nextOffset: null });
    expect(commands[0]).toMatchObject({ type: 'readBusinessFile', query: { path: 'result.bin', offset: 0, limit: 3 } });
    const list = await f.request(`${path}/files?limit=1`);
    expect(list.status).toBe(200); expect(await list.json()).toMatchObject({ entries: [{ name: 'file' }] });
    for (const query of ['path=../secret', 'path=/etc/passwd', 'path=a&limit=1048577', 'path=a&offset=1', 'path=a&surprise=true']) expect((await f.request(`${path}/file?${query}`)).status).toBe(400);
    const other = await active();
    expect((await other.request(`${path}/file?path=file`)).status).toBe(404);
    expect(commands.length).toBe(2);
    expect(f.behavior.starts).toBe(1);
  });

  test('paused/offline/closing workspaces never dispatch or acquire compute', async () => {
    const f = await active(), path = `/v3/business-tasks/${f.task.id}`; let commands = 0;
    f.runner.sendCommand = async () => { commands++; throw new Error('must not dispatch'); };
    f.env.state = 'paused';
    for (const suffix of ['file?path=artifact', 'files']) {
      const result = await f.request(`${path}/${suffix}`);
      expect(result.status).toBe(409); expect(await result.json()).toMatchObject({ details: { code: 'task_paused' } });
    }
    f.env.state = 'running'; f.env.connected = false;
    expect((await f.request(`${path}/files`)).status).toBe(412);
    f.env.connected = true; f.env.state = 'releasing';
    expect((await f.request(`${path}/files`)).status).toBe(412);
    expect(commands).toBe(0); expect(f.behavior.starts).toBe(1);
  });

  test('Runner file failures retain machine codes and correct HTTP status', async () => {
    const f = await active(), path = `/v3/business-tasks/${f.task.id}/file?path=artifact`;
    for (const [code, expected] of [['file_version_changed', 409], ['path_denied', 403], ['not_found', 404], ['invalid_cursor', 400], ['invalid_offset', 400], ['invalid_file_type', 400], ['unsupported_capability', 412]] as const) {
      f.runner.sendCommand = async () => { throw new PlatformError('precondition', 'file error', { code }); };
      const response = await f.request(path); expect(response.status).toBe(expected);
      expect(await response.json()).toMatchObject({ details: { code } });
    }
  });
});
