import { expect, test } from 'bun:test';
import { createEventStream } from '../drivers/eventStream';

test('bounded business stream fails visibly after preserving its admitted prefix; consumed capacity is reusable', async () => {
  const stream = createEventStream<string>(10), iterator = stream[Symbol.asyncIterator]();
  stream.push('abcd'); expect((await iterator.next()).value).toBe('abcd');
  stream.push('efgh'); expect(() => stream.push('ijkl')).toThrow('buffer');
  expect((await iterator.next()).value).toBe('efgh');
  await expect(iterator.next()).rejects.toThrow('buffer'); expect(stream.closed).toBe(true);
});
