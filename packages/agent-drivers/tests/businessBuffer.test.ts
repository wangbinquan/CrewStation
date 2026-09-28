import { expect, test } from 'bun:test';
import { createEventStream } from '../drivers/eventStream';

test('bounded business stream fails visibly after preserving its admitted prefix; consumed capacity is reusable', async () => {
  const stream = createEventStream<string>(10), iterator = stream[Symbol.asyncIterator]();
  stream.push('abcd'); expect((await iterator.next()).value).toBe('abcd');
  stream.push('efgh'); expect(() => stream.push('ijkl')).toThrow('buffer');
  expect((await iterator.next()).value).toBe('efgh');
  await expect(iterator.next()).rejects.toThrow('buffer'); expect(stream.closed).toBe(true);
});

// Final native capture can exceed queue capacity in total; wait for consumers instead of dropping proof frames.
test('awaited writes preserve order across backpressure and release blocked writers on consumer exit', async () => {
  const stream = createEventStream<string>(10), iterator = stream[Symbol.asyncIterator]();
  await stream.write('abcd'); let admitted = false;
  const pending = stream.write('efgh').then(() => { admitted = true; });
  await Promise.resolve(); expect(admitted).toBe(false);
  expect((await iterator.next()).value).toBe('abcd'); await pending; expect(admitted).toBe(true);
  const blocked = stream.write('ijkl').then(() => null, (error: unknown) => error);
  await iterator.return?.(); expect(await blocked).toBeInstanceOf(Error); expect(stream.closed).toBe(true);
});
test('awaited writes retain failure reasons and reject oversized frames', async () => {
  const stream = createEventStream<string>(10);
  await expect(stream.write('0123456789')).rejects.toThrow('exceeds');
  await stream.write('abcd'); const failure = new Error('source stopped');
  const blocked = stream.write('efgh').then(() => null, (error: unknown) => error);
  stream.fail(failure); expect(await blocked).toBe(failure);
  const iterator = stream[Symbol.asyncIterator](); expect((await iterator.next()).value).toBe('abcd');
  await expect(iterator.next()).rejects.toBe(failure);
});


// Returning an unstarted async generator never enters its finally block.
test('processed receipts reject before first next, while yielded, queued, or waiting for capacity', async () => {
  for (const consume of [false, true]) {
    const stream = createEventStream<string>(10), iterator = stream[Symbol.asyncIterator]();
    const first = stream.writeProcessed('abcd').then(() => 'processed', (error: unknown) => error);
    if (consume) expect((await iterator.next()).value).toBe('abcd');
    const queued = stream.writeProcessed('efgh').then(() => 'processed', (error: unknown) => error);
    const capacity = stream.writeProcessed('ijkl').then(() => 'processed', (error: unknown) => error);
    await iterator.return?.();
    for (const receipt of [first, queued, capacity]) expect(await receipt).toBeInstanceOf(Error);
  }
});
test('a processed receipt resolves only after the consumer resumes from its yield', async () => {
  const stream = createEventStream<string>(10), iterator = stream[Symbol.asyncIterator]();
  let processed = false; const receipt = stream.writeProcessed('abcd').then(() => { processed = true; });
  expect((await iterator.next()).value).toBe('abcd'); await Promise.resolve(); expect(processed).toBe(false);
  stream.close(); expect((await iterator.next()).done).toBe(true); await receipt; expect(processed).toBe(true);
});
