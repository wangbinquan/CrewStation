import { expect, test } from 'bun:test';
import { periodicJob } from './periodic';

test('定时作业：启动即跑一次、此后按周期；失败交给 onError 不打断节奏；上一轮没跑完这一拍跳过；重复启动不叠加；停止时等本轮跑完', async () => {
  let calls = 0, inFlight = 0, maxInFlight = 0, finished = 0;
  const errors: unknown[] = [];
  const job = periodicJob(async () => {
    calls += 1; inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await Bun.sleep(15);
      if (calls === 2) throw new Error('暂时不可用');
    } finally { inFlight -= 1; finished += 1; }
  }, (error) => { errors.push(error); }, 5);
  job.start(); job.start();
  const deadline = Date.now() + 2_000;
  while (calls < 3 && Date.now() < deadline) await Bun.sleep(2);
  await job.stop();
  expect(calls).toBeGreaterThanOrEqual(3);
  expect(maxInFlight).toBe(1);
  expect(finished).toBe(calls);
  expect(errors.map(String)).toEqual(['Error: 暂时不可用']);
  const after = calls;
  await Bun.sleep(20);
  expect(calls).toBe(after);
});
