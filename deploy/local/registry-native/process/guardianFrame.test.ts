import { expect, test } from 'bun:test';
import { guardianFrame } from './guardianFrame';

const chunks = (values: Uint8Array[]) => new ReadableStream<Uint8Array>({ start(controller) { for (const value of values) controller.enqueue(value); controller.close(); } }).getReader();
test('guardian origin and ready frames survive every byte boundary, including UTF-8', async () => {
  const origin = '{"original":"原进程"}', bytes = Buffer.from(origin + '\n');
  for (let split = 1; split < bytes.length; split++) {
    const reader = chunks([bytes.subarray(0, split), bytes.subarray(split)]);
    try { expect(await guardianFrame(reader, 65_536, AbortSignal.timeout(1000))).toBe(origin); } finally { reader.releaseLock(); }
  }
  const reader = chunks([...Buffer.from('ready\n')].map(byte => Uint8Array.of(byte)));
  try { expect(await guardianFrame(reader, 6, AbortSignal.timeout(1000))).toBe('ready'); } finally { reader.releaseLock(); }
});
test('EOF, partial origin, extra disarm, invalid UTF-8 and oversize frames cannot confirm native ownership', async () => {
  const cases = [[], [Buffer.from('done')], [Buffer.from('done\nextra')], [Uint8Array.of(255, 10)], [Buffer.from('longer\n')]];
  for (let index = 0; index < cases.length; index++) {
    const reader = chunks(cases[index]!);
    try { if (!index) expect(await guardianFrame(reader, 5, AbortSignal.timeout(1000))).toBeUndefined();
      else await expect(guardianFrame(reader, index === 2 ? 100 : 5, AbortSignal.timeout(1000))).rejects.toThrow();
    } finally { reader.releaseLock(); }
  }
});
test('a deadline cancels an incomplete pipe read before its lock or original pidfd can be released', async () => {
  let cancelled = false;
  const reader = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Buffer.from('do')); }, cancel() { cancelled = true; } }).getReader();
  try { await expect(guardianFrame(reader, 5, AbortSignal.timeout(10))).rejects.toThrow(); expect(cancelled).toBe(true); } finally { reader.releaseLock(); }
});
