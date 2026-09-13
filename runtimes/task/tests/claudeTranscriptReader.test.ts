import { afterEach, expect, test } from 'bun:test';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClaudeTranscriptNode } from '@crewstation/agent-drivers';
import { ClaudeTranscriptReader } from '../src/activity/claudeTranscriptReader';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cs-transcript-reader-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const nodes: ClaudeTranscriptNode[] = []; let gaps = 0;
  const reader = new ClaudeTranscriptReader((node) => nodes.push(node), () => { gaps++; });
  cleanups.push(async () => { reader.close(); });
  const path = join(root, 'session.jsonl'); reader.track('session', path);
  return { root, path, reader, nodes, gaps: () => gaps };
}
const node = { uuid: 'u', parentUuid: null, sessionId: 'session', type: 'user', origin: { kind: 'human' }, promptId: 'p', version: '2.1.268', message: { content: '中文私有正文' } };

test('文件尚未创建和半行追加不会猜结果，UTF-8 分块完整解析且不重复读', async () => {
  const f = await fixture(); await f.reader.read(); expect(f.gaps()).toBe(0);
  const bytes = Buffer.from(`${JSON.stringify(node)}\n`); const cut = bytes.indexOf('中文') + 1;
  await writeFile(f.path, bytes.subarray(0, cut)); await f.reader.read(); expect(f.nodes).toEqual([]);
  await appendFile(f.path, bytes.subarray(cut)); await Promise.all([f.reader.read(), f.reader.read()]);
  expect(f.nodes).toHaveLength(1); expect(f.nodes[0]?.humanPrompt).toBe(true); expect(f.gaps()).toBe(0);
  expect(JSON.stringify(f.nodes)).not.toContain('私有正文');
});

test('文件截断、异常 JSON、跨会话和超大行都显式失去可信状态', async () => {
  const f = await fixture(); await writeFile(f.path, `${JSON.stringify(node)}\n`); await f.reader.read();
  await writeFile(f.path, ''); await f.reader.read(); expect(f.gaps()).toBe(1);
  const g = await fixture(); await writeFile(g.path, '{invalid}\n'); await g.reader.read(); expect(g.gaps()).toBe(1);
  const h = await fixture(); await writeFile(h.path, `${JSON.stringify({ ...node, sessionId: 'other' })}\n`); await h.reader.read(); expect(h.gaps()).toBe(1);
  const k = await fixture(); await writeFile(k.path, 'x'.repeat(2 * 1024 * 1024 + 1));
  await k.reader.read(); await k.reader.read(); await k.reader.read(); expect(k.gaps()).toBe(1);
});

test('关闭收集器不会再读取文件；hook 路径必须与原生会话对应', async () => {
  const f = await fixture(); f.reader.track('another', f.path); expect(f.gaps()).toBe(1);
  f.reader.close(); await writeFile(f.path, `${JSON.stringify(node)}\n`); await f.reader.read(); expect(f.nodes).toEqual([]);
});
