import { expect, test } from 'bun:test';
import { noopLogger } from '@crewstation/kernel';
import { projectWorkObserver } from '../workers/projectWorkObserver';
import type { ProvisioningProjectWork } from '../ports/projectWork';

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function source(observe: () => Promise<void>): ProvisioningProjectWork {
  return { observe, run: async (_project, _service, _kind, _digest, work) => work(), checkCurrent: async () => undefined,
    history: async () => [], close: async () => ({ pending: [] }) };
}
test('重复启动不能多开原回调观测周期；关闭等待当前观测并取消后续计时器', async () => {
  let calls = 0;
  const observer = projectWorkObserver(source(async () => { calls++; }), noopLogger);
  try {
    observer.start(); await turn(); observer.start(); await turn();
    // The completed initial scan used to make a second start create another periodic scan.
    expect(calls).toBe(1);
  } finally { await observer.stop(); }
});
test('观测在途时重复启动共用一次；关闭在实际来源返回之前不会提前完成', async () => {
  const result = Promise.withResolvers<void>(); let calls = 0;
  const observer = projectWorkObserver(source(async () => { calls++; await result.promise; }), noopLogger);
  try {
    observer.start(); observer.start(); expect(calls).toBe(1);
    let stopped = false; const stopping = observer.stop().then(() => { stopped = true; });
    await turn(); expect(stopped).toBe(false); result.resolve(); await stopping; expect(stopped).toBe(true);
  } finally { result.resolve(); await observer.stop(); }
});
test('读取故障仍可停止，不把原来源错误内容写入日志', async () => {
  const messages: string[] = [];
  const observer = projectWorkObserver(source(async () => { throw new Error('controlled-private-source-error'); }),
    { ...noopLogger, warn: (message) => { messages.push(message); } });
  try { observer.start(); await turn(); expect(messages).toHaveLength(1); expect(messages.join()).not.toContain('controlled-private-source-error'); }
  finally { await observer.stop(); }
});
