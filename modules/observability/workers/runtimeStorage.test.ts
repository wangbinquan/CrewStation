import {expect,test} from 'bun:test';
import {noopLogger} from '@crewstation/kernel';
import {runtimeStorageWorker} from './runtimeStorage';
test('an in-flight pass is drained exactly once on stop',async()=>{let release!:()=>void,calls=0,samples=0;const held=new Promise<void>(r=>release=r),worker=runtimeStorageWorker({collect:async()=>{calls++;await held;return 0;},sample:async()=>{samples++;},failed:async()=>{throw Error('unexpected');}},noopLogger);worker.start();worker.start();const stopped=worker.stop();release();await stopped;expect(calls).toBe(1);expect(samples).toBe(1);});
test('disk failure never runs a successful sample or rejects producer shutdown',async()=>{let failed=0,samples=0;const worker=runtimeStorageWorker({collect:async()=>{throw Error('disk full');},sample:async()=>{samples++;},failed:async()=>{failed++;throw Error('still full');}},noopLogger);worker.start();await worker.drain();await worker.stop();expect(failed).toBe(1);expect(samples).toBe(0);});

test('idle maintenance sleeps for a minute; productive and slow passes yield without dropping the next sweep', async () => {
  let clock = 1000,
    calls = 0,
    scheduled: (() => void) | undefined,
    cancelled = false
  const delays: number[] = [],
    worker = runtimeStorageWorker({
      now: () => clock,
      collect: async () => {
        calls++
        if (calls === 1) return 0
        clock += calls === 2 ? 5 : 200
        return 500
      },
      sample: async () => {},
      failed: async () => {
        throw Error('unexpected')
      },
      schedule: (callback, ms) => {
        delays.push(ms)
        scheduled = callback
        return () => {
          cancelled = true
        }
      },
    }, noopLogger)
  worker.start()
  await worker.drain()
  expect(delays).toEqual([60000])
  worker.start()
  expect(calls).toBe(1)
  scheduled!()
  await worker.drain()
  expect(delays).toEqual([60000, 1000])
  scheduled!()
  await worker.drain()
  expect(delays).toEqual([60000, 1000, 3800])
  await worker.stop()
  expect(cancelled).toBe(true)
  scheduled!()
  expect(calls).toBe(3)
})

test('maintenance failure backs off for a minute without a one-second error loop', async () => {
  const delays: number[] = [],
    worker = runtimeStorageWorker({
      collect: async () => {
        throw Error('database busy')
      },
      sample: async () => {},
      failed: async () => {},
      schedule: (_callback, ms) => {
        delays.push(ms)
        return () => {}
      },
    }, noopLogger)
  worker.start()
  await worker.drain()
  expect(delays).toEqual([60000])
  await worker.stop()
})

test('the same maintenance owner resumes after a completed pause without duplicate schedules', async () => {
  let calls = 0,
    schedules = 0,
    cancellations = 0
  const worker = runtimeStorageWorker({
    collect: async () => {
      calls++
      return 0
    },
    sample: async () => {},
    failed: async () => {},
    schedule: () => {
      schedules++
      return () => {
        cancellations++
      }
    },
  }, noopLogger)
  for (let cycle = 1; cycle <= 3; cycle++) {
    worker.start()
    worker.start()
    await worker.drain()
    expect(calls).toBe(cycle)
    expect(schedules).toBe(cycle)
    await worker.stop()
    expect(cancellations).toBe(cycle)
  }
})

test('a protected live prefix advances promptly even when its page reclaims zero rows', async () => {
  let calls = 0
  const delays: number[] = [],
    worker = runtimeStorageWorker({
      collect: async () => ({ removed: 0, scanned: ++calls === 1 ? 500 : 0 }),
      sample: async () => {},
      failed: async () => {},
      schedule: (_callback, ms) => {
        delays.push(ms)
        return () => {}
      },
    },noopLogger)
  worker.start()
  await worker.drain()
  expect(delays).toEqual([1000])
  await worker.stop()
  worker.start()
  await worker.drain()
  expect(delays).toEqual([1000, 60000])
  await worker.stop()
})
