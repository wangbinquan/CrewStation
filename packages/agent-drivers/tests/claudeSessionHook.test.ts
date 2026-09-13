import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { claudeSessionHookCommand, renderClaudeSessionHook } from '../drivers/claudeCode/nativeSessionHook';

test('真实 command hook 处理带引号的脚本路径，只报告会话结构且不向 CLI 注入输出', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-session-hook-'));
  const received: unknown[] = [];
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) { received.push(await request.json()); return Response.json({}); } });
  try {
    const path = join(root, "observer ' quoted.mjs");
    await writeFile(path, renderClaudeSessionHook(`http://127.0.0.1:${server.port}`));
    const child = Bun.spawn(['sh', '-c', claudeSessionHookCommand(path)], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    child.stdin.write(JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'session', transcript_path: '/tmp/session.jsonl', cwd: '/private/work', private: 'prompt is not forwarded' }));
    child.stdin.end();
    expect(await child.exited).toBe(0);
    expect(await new Response(child.stdout).text()).toBe('');
    expect(await new Response(child.stderr).text()).toBe('');
    expect(received).toEqual([{ hook_event_name: 'SessionStart', session_id: 'session', transcript_path: '/tmp/session.jsonl' }]);
  } finally { server.stop(true); await rm(root, { recursive: true, force: true }); }
});
