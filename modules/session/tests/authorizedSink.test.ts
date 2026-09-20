import { expect, test } from 'bun:test';
import { authorizedSink } from '../application/authorizedSink';

test('每批现查权限，撤销后丢弃排队消息并关闭；不缓存先前许可', async () => {
  let permitted = true, checks = 0, unsubscribed = 0;
  const frames: string[] = [], closed: number[] = [];
  const sink = authorizedSink({ send: (frame) => { frames.push(frame); }, close: (code) => { closed.push(code); } }, async () => { checks++; return permitted; }, () => { unsubscribed++; });
  sink.send('one'); sink.send('two'); await sink.drain();
  expect(frames).toEqual(['one', 'two']); expect(checks).toBe(1);
  permitted = false; sink.send('private'); await sink.drain();
  expect(frames).not.toContain('private'); expect(JSON.parse(frames.at(-1)!)).toMatchObject({ code: 'forbidden' });
  expect(closed).toEqual([1008]); expect(unsubscribed).toBe(1);
  expect(await sink.check()).toBe(false); sink.send('late'); await sink.drain(); expect(frames).not.toContain('late');
});

test('权限查询异常、主动关闭与积压都停止传输，发送失败释放订阅', async () => {
  const frames: string[] = [];
  const failed = authorizedSink({ send: (frame) => { frames.push(frame); } }, async () => { throw new Error('offline'); }, () => {});
  expect(await failed.check()).toBe(false); expect(frames).toHaveLength(1);
  const closed = authorizedSink({ send: (frame) => { frames.push(frame); } }, async () => true, () => {});
  closed.send('secret'); closed.close(); await closed.drain(); expect(frames).not.toContain('secret');
  const overflow = authorizedSink({ send: (frame) => { frames.push(frame); } }, async () => true, () => {});
  overflow.send('x'.repeat(8 * 1024 * 1024 + 1)); await overflow.drain(); expect(frames).toHaveLength(2);
  let released = false;
  const broken = authorizedSink({ send: () => { throw new Error('socket closed'); } }, async () => true, () => { released = true; });
  broken.send('payload'); await expect(broken.drain()).rejects.toThrow('socket closed'); expect(released).toBe(true);
});
