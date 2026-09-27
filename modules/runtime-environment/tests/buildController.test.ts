import { afterEach, describe, expect, test } from 'bun:test';
import { CreateRuntimeImageRevisionSchema } from '@crewstation/contracts';
import { PlatformError } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { digest, runtimeImageFixture, type RuntimeImageFixture } from './runtimeImageFixture';
import { buildExecutorFixture } from './buildExecutorFixture';

const available = await testDatabaseAvailable(), fixtures: RuntimeImageFixture[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.tdb.drop(); });
async function setup() {
  const driver = buildExecutorFixture(), f = await runtimeImageFixture(driver.executor); fixtures.push(f);
  const image = await f.image(), revision = await f.revision(image.id);
  const build = await f.api.startBuild(f.developer, f.project, image.id, { revisionId: revision.id, requestKey: 'build' });
  return { f, driver, image, build, read: () => f.api.getBuild(f.developer, f.project, image.id, build.id) };
}
async function untilCalled(calls: string[], length: number) {
  for (let attempt = 0; attempt < 100 && calls.length < length; attempt++) await Bun.sleep(1);
  expect(calls.length).toBeGreaterThanOrEqual(length);
}

describe.skipIf(!available)('构建控制器恢复、物理停止与可信产物', () => {
  test('只有完整回收后发布版本，日志有上限且游标去重，终态重复调和无副作用', async () => {
    const { f, driver, build, image, read } = await setup();
    await f.api.runBuild(build.id);
    expect(await read()).toMatchObject({ state: 'building', unknown: false });
    expect(await f.uow.read.logs.bytes(build.id)).toBe(1024);
    driver.state('succeeded'); await f.api.runBuild(build.id);
    expect(await read()).toMatchObject({ state: 'inspecting', stage: 'stopping' });
    expect(await f.api.listVersions(f.developer, f.project, image.id, { limit: 10 })).toEqual([]);
    expect(await f.uow.read.builds.activeCount()).toBe(1);
    driver.stopped(true); await f.api.reconcileBuilds();
    expect(await read()).toMatchObject({ state: 'succeeded' });
    expect(await f.uow.read.builds.activeCount()).toBe(0);
    const versions = await f.api.listVersions(f.developer, f.project, image.id, { limit: 10 });
    expect(versions).toHaveLength(1); expect(versions[0]?.digest).toBe(digest);
    const calls = driver.calls.length;
    await f.api.runBuild(build.id); expect(driver.calls).toHaveLength(calls);
    expect(await f.uow.read.logs.bytes(build.id)).toBe(1024);
    expect(await f.api.listValidations(f.developer, f.project, versions[0]!.id)).toEqual([]);
  });

  test('取消使旧租约立即失效，晚到成功不能复活；停止确认前仍占容量', async () => {
    const { f, driver, build, image, read } = await setup();
    driver.state('succeeded'); driver.block();
    const oldWorker = f.api.runBuild(build.id);
    await untilCalled(driver.calls, 1);
    await f.api.cancelBuild(f.developer, f.project, image.id, build.id, 'cancel');
    driver.unblock(); await oldWorker;
    expect(driver.calls).not.toContain('inspect');
    await f.api.runBuild(build.id);
    expect(await read()).toMatchObject({ state: 'cancelling' });
    expect(await f.uow.read.builds.activeCount()).toBe(1);
    driver.stopped(true); await f.api.runBuild(build.id);
    expect(await read()).toMatchObject({ state: 'cancelled' });
    expect(await f.api.listVersions(f.developer, f.project, image.id, { limit: 10 })).toEqual([]);
  });

  test('租约过期由新控制器接管，旧控制器返回不能覆盖已完成记录', async () => {
    const { f, driver, build, image, read } = await setup();
    driver.block(); const first = f.api.runBuild(build.id); await untilCalled(driver.calls, 1);
    await f.api.runBuild(build.id); expect(driver.calls).toHaveLength(1);
    f.advance(60001); driver.state('succeeded'); driver.stopped(true);
    await f.api.runBuild(build.id);
    expect(await read()).toMatchObject({ state: 'succeeded' });
    driver.unblock(); await first;
    expect(await read()).toMatchObject({ state: 'succeeded' });
    expect(await f.api.listVersions(f.developer, f.project, image.id, { limit: 10 })).toHaveLength(1);
  });

  test('伪造 receipt epoch 校验失败且清理后才退额，不登记伪造产物', async () => {
    const { f, driver, build, image, read } = await setup();
    driver.state('succeeded'); driver.foreignReceipt();
    await f.api.runBuild(build.id);
    expect(driver.calls).not.toContain('inspect');
    expect(await f.uow.read.builds.activeCount()).toBe(1);
    driver.stopped(true); await f.api.runBuild(build.id);
    expect(await read()).toMatchObject({ state: 'failed' });
    expect(await f.api.listVersions(f.developer, f.project, image.id, { limit: 10 })).toEqual([]);
  });

  test('仓库失联保持 unknown 与原资源；达到 deadline 则先回收再失败', async () => {
    const { f, driver, build, read } = await setup();
    driver.state('succeeded'); driver.inspectionError(new PlatformError('unavailable', 'registry offline'));
    await f.api.runBuild(build.id);
    expect(await read()).toMatchObject({ state: 'inspecting', unknown: true });
    expect(await f.uow.read.builds.activeCount()).toBe(1);
    f.advance(601000); await f.api.runBuild(build.id);
    expect(await read()).toMatchObject({ stage: 'stopping' });
    driver.stopped(true); await f.api.runBuild(build.id);
    expect(await read()).toMatchObject({ state: 'failed', error: '镜像构建超过截止时间', unknown: false });
  });

  test('登记已有镜像只检查固定产物，不创建虚假构建资源', async () => {
    const driver = buildExecutorFixture(), f = await runtimeImageFixture(driver.executor); fixtures.push(f);
    const image = await f.image(), revision = await f.api.createRevision(f.developer, f.project, image.id, CreateRuntimeImageRevisionSchema.parse({ source: { kind: 'existing', reference: 'registry.test/project/tools:v1', architecture: 'linux/amd64', usage: 'service' } }));
    const build = await f.api.startBuild(f.developer, f.project, image.id, { revisionId: revision.id, requestKey: 'import' });
    await f.api.runBuild(build.id);
    expect(driver.calls).toEqual(['inspect']);
    expect(await f.api.getBuild(f.developer, f.project, image.id, build.id)).toMatchObject({ state: 'succeeded' });
    expect(await f.api.listVersions(f.developer, f.project, image.id, { limit: 10 })).toHaveLength(1);
  });
});
