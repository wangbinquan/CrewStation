import { describe, expect, test } from 'bun:test';
import type { BeforeStartStep } from '@crewstation/contracts';
import { PROFILE_TEST_MCP_TOKEN, profileTestMcp } from '../domain/profileTestEnvironment';

const endpoints = [{ name: 'capabilities', url: 'http://caps/mcp' }, { name: 'operations', url: 'http://ops/mcp' }];
const file = (contentTemplate: string): BeforeStartStep => ({ kind: 'file', stepId: 'f', name: 'f', pathTemplate: '{{agent.home}}/f.txt', contentTemplate, format: 'text', mode: 0o600, existing: 'require-same' });
const script: BeforeStartStep = { kind: 'script', stepId: 's', name: 's', language: 'shell', source: 'echo {{mcp.token}}', argv: [], timeoutMs: 1000 };

describe('档位测试里的 {{mcp.*}}（RFC-006 C16）', () => {
  test('文件步骤内容引用了 mcp.* 才给平台 MCP 地址，令牌是不授权的占位值', () => {
    expect(profileTestMcp([file('ops={{ mcp.operationsUrl }}')], endpoints)).toEqual(endpoints.map((e) => ({ ...e, headers: { 'x-cs-dev-session-token': PROFILE_TEST_MCP_TOKEN } })));
    expect(profileTestMcp([file('token={{mcp.token}}')], endpoints)).toHaveLength(2);
  });

  test('没有引用（或只有脚本正文里的字面文本、变量与凭据引用）时不注入 MCP，测试轮次与之前一样', () => {
    expect(profileTestMcp([], endpoints)).toEqual([]);
    expect(profileTestMcp([file('key={{secrets.KEY}} v={{vars.V}}')], endpoints)).toEqual([]);
    expect(profileTestMcp([script], endpoints)).toEqual([]);
  });
});
