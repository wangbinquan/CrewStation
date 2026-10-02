import { expect, test } from 'bun:test';
import { scmCallbackObserver } from './projectAdmission';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

test('SCM 停止观测有正式后台生命周期；重复启动不并发，关闭等待原观察完成，关闭后可恢复', async () => {
  const entered = deferred(), release = deferred(); let calls = 0, finished = false;
  const observer = scmCallbackObserver(async () => { calls += 1; entered.resolve(); await release.promise; });
  observer.start(); observer.start(); await entered.promise;
  expect(calls).toBe(1);
  const stopping = observer.stop().then(() => { finished = true; });
  await Promise.resolve(); expect(finished).toBe(false);
  release.resolve(); await stopping; expect(finished).toBe(true);
  observer.start(); await observer.stop(); expect(calls).toBe(2);
});

test('SCM 来源读取故障被后台保留为失败，下一轮仍可继续，不输出来源秘密或解除保护', async () => {
  const warnings: string[] = []; let calls = 0;
  const observer = scmCallbackObserver(async () => { if (calls++ === 0) throw new Error('private-source-credential'); }, (message) => { warnings.push(message); });
  observer.start(); await observer.stop();
  expect(warnings).toEqual(['SCM callback source observation failed; original protection retained']);
  expect(JSON.stringify(warnings)).not.toContain('private-source-credential');
  observer.start(); await observer.stop(); expect(calls).toBe(2);
});
