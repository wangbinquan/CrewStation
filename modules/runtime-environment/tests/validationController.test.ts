import { afterEach, describe, expect, test } from 'bun:test';
import { newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import type { RuntimeImageValidationExecutor, RuntimeImageValidationResult } from '../ports/validationExecutor';
import { runtimeImageFixture, digest } from './runtimeImageFixture';
import { builtVersion } from './versionFixture';

const available = await testDatabaseAvailable(), cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
const passed: RuntimeImageValidationResult = { state: 'passed', observedImageId: `registry.test/project/tools@${digest}`, checks: [{ key: 'worker', passed: true, output: '10001', exitCode: 0 }] };
async function fixture(executor: RuntimeImageValidationExecutor) {
  const f = await runtimeImageFixture(undefined, undefined, executor); cleanups.push(() => f.tdb.drop());
  const version = await builtVersion(f), validation = await f.api.startValidation(f.developer, f.project, version.id, { requestKey: newResourceId(), target: { usage: 'task' } });
  return { ...f, version, validation, read: () => f.api.getValidation(f.developer, f.project, version.id, validation.id) };
}

describe.skipIf(!available)('用途验证控制器', () => {
  test('结果提交前确认物理停止，重试不重复执行，最终释放验证引用', async () => {
    let runs = 0, stopped = false;
    const f = await fixture({ run: async (context, heartbeat) => { runs++; expect(context.snapshot.validationId).toBe(context.validation.id); expect(await heartbeat()).toBe(true); return passed; }, stop: async () => stopped });
    await f.api.runValidation(f.validation.id);
    expect(await f.read()).toMatchObject({ state: 'running' });
    expect(await f.uow.read.references.get(f.version.id, 'validation', f.validation.id)).toBeDefined();
    stopped = true;
    await f.api.reconcileValidations();
    expect(await f.read()).toMatchObject(passed);
    expect(runs).toBe(1);
    expect(await f.uow.read.references.get(f.version.id, 'validation', f.validation.id)).toBeUndefined();
    await f.api.runValidation(f.validation.id); expect(runs).toBe(1);
  });

  test('外部异常后接管只清理并报告 unknown，取消排队验证不执行脚本', async () => {
    let runs = 0, stops = 0;
    const f = await fixture({ run: async () => { runs++; throw new Error('response lost'); }, stop: async () => { stops++; return true; } });
    await f.api.runValidation(f.validation.id); await f.api.runValidation(f.validation.id);
    expect(await f.read()).toMatchObject({ state: 'unknown' }); expect(runs).toBe(1); expect(stops).toBe(1);
    const cancelled = await f.api.startValidation(f.developer, f.project, f.version.id, { requestKey: 'cancel-before-run', target: { usage: 'task' } });
    expect(await f.api.cancelValidation(f.developer, f.project, f.version.id, cancelled.id, 'stop')).toMatchObject({ state: 'cancelling' });
    await expect(f.api.cancelValidation(f.developer, f.project, f.version.id, cancelled.id, 'other')).rejects.toMatchObject({ kind: 'conflict' });
    await f.api.runValidation(cancelled.id);
    expect(await f.api.getValidation(f.developer, f.project, f.version.id, cancelled.id)).toMatchObject({ state: 'cancelled' });
    expect(runs).toBe(1); expect(stops).toBe(2);
  });

  test('租约过期的迟到结果不能覆盖接管结果，错误实际摘要不能通过', async () => {
    let finish!: (value: RuntimeImageValidationResult) => void, began!: () => void;
    const running = new Promise<void>((resolve) => { began = resolve; });
    let runs = 0;
    const f = await fixture({ run: async () => { runs++; began(); return new Promise((resolve) => { finish = resolve; }); }, stop: async () => true });
    const original = f.api.runValidation(f.validation.id); await running;
    await f.api.runValidation(f.validation.id); expect(runs).toBe(1);
    f.advance(60001); await f.api.runValidation(f.validation.id);
    finish(passed); await original;
    expect(await f.read()).toMatchObject({ state: 'unknown' }); expect(runs).toBe(1);
    const wrong = await fixture({ run: async () => ({ ...passed, observedImageId: `registry/tools@sha256:${'f'.repeat(64)}` }), stop: async () => true });
    await wrong.api.runValidation(wrong.validation.id);
    expect(await wrong.read()).toMatchObject({ state: 'failed' });
  });
});
