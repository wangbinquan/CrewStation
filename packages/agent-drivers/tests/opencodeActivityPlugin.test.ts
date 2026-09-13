import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderOpencodeActivityPlugin } from '../drivers/opencode/nativeActivityPlugin';

test('生成的真实插件只发送状态字段，串行重试保序，不改变原生问题的答复', async () => {
  const payloads: Array<{ sequence: number; event: Record<string, unknown> }> = [];
  let done!: () => void, failedOnce = false;
  const complete = new Promise<void>((resolve) => { done = resolve; });
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    expect(req.headers.get('authorization')).toBe('Bearer observer-token');
    const payload = await req.json() as typeof payloads[number];
    if (!failedOnce) { failedOnce = true; return new Response(null, { status: 503 }); }
    payloads.push(payload);
    if (payloads.length === 6) done();
    return Response.json({});
  } });
  const source = renderOpencodeActivityPlugin(`http://127.0.0.1:${server.port}`, 'observer-token');
  const root = await mkdtemp(join(tmpdir(), 'cs-observer-plugin-'));
  const file = join(root, 'observer.mjs');
  await writeFile(file, source);
  const module = await import(file);
  const hooks = await module.default({ client: {} });
  const event = (type: string, properties: unknown) => hooks.event({ event: { id: `event-${type}`, type, properties } });
  const original = { message: { id: 'user', time: { created: 1 }, content: 'private prompt' } };
  try {
    await event('session.created', { info: { id: 'root', directory: '/work', title: 'private title' } });
    await hooks['chat.message']({ sessionID: 'root' }, original);
    await event('message.updated', { sessionID: 'root', info: { id: 'assistant', parentID: 'user', role: 'assistant', time: { created: 2 }, text: 'private reply', tokens: { cost: 42 } } });
    await event('question.asked', { sessionID: 'root', id: 'question', tool: { messageID: 'assistant' }, questions: [{ question: 'private question' }] });
    await event('question.replied', { sessionID: 'root', requestID: 'question', answers: [['private answer']] });
    await complete;
    expect(payloads.map((item) => item.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(payloads.map((item) => item.event.type)).toEqual(['ready', 'session', 'prompt', 'assistant', 'request', 'resolved']);
    expect(JSON.stringify(payloads)).not.toContain('private');
    expect(original.message.content).toBe('private prompt');
  } finally { await event('server.instance.disposed', {}); server.stop(true); await rm(root, { recursive: true, force: true }); }
});
