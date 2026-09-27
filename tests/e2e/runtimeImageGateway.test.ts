import { afterAll, expect, test } from 'bun:test';
import { e2eAvailable } from './consoleSession';
import { openAdminSession } from './session';

const available = await e2eAvailable(), session = available ? await openAdminSession() : undefined;
afterAll(async () => { await session?.close(); }, 30_000);

test.skipIf(!session)('开发镜像的三个v2入口经真实网关返回API校验结果，不落入控制台HTML', async () => {
  const id = '01900000-0000-7000-8000-000000000001';
  for (const path of [`/v2/projects/${id}/dev-session`, `/v2/tasks/${id}/agents`, `/v2/tasks/${id}/agent-terminals`]) {
    // Missing required fields fail before resource admission, so this check creates no workspace or execution.
    const response = await session!.admin.eval<{ status: number; contentType: string; body: string }>(`fetch(${JSON.stringify(path)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(async r => ({ status: r.status, contentType: r.headers.get('content-type'), body: await r.text() }))`);
    expect(response.status).toBe(400);
    expect(response.contentType).toContain('application/json');
    expect(JSON.parse(response.body).error).toBe('validation');
  }
}, 30_000);
