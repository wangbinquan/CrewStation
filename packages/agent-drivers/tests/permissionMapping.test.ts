import { describe, expect, test } from 'bun:test';
import { claudeToolGateFor, claudeToolsValue, mapAgentPermissionToClaudeTools } from '../permission/claudeToolGate';
import { OPENCODE_PERMISSION_KEYS, opencodePermissionFor } from '../permission/opencodePermission';

describe('三档权限 → opencode permission map', () => {
  test('full 用通配 allow', () => {
    expect(opencodePermissionFor('full')).toEqual({ '*': 'allow' });
  });

  test('read-only 放行读面与网络，写面与 bash／task 一律 deny', () => {
    const map = opencodePermissionFor('read-only');
    expect(map.read).toBe('allow');
    expect(map.glob).toBe('allow');
    expect(map.grep).toBe('allow');
    expect(map.list).toBe('allow');
    expect(map.webfetch).toBe('allow');
    expect(map.websearch).toBe('allow');
    expect(map.edit).toBe('deny');
    expect(map.bash).toBe('deny');
    expect(map.task).toBe('deny');
    expect(map.skill).toBe('deny');
  });

  test('edit 在只读之上加写面与辅助面，仍不给 bash／task', () => {
    const map = opencodePermissionFor('edit');
    expect(map.edit).toBe('allow');
    expect(map.skill).toBe('allow');
    expect(map.todowrite).toBe('allow');
    expect(map.bash).toBe('deny');
    expect(map.task).toBe('deny');
  });

  test('逐键列出（opencode 默认 allow-unless-denied，只列 allow 会漏放）；不合成 external_directory', () => {
    const map = opencodePermissionFor('edit');
    const expected = OPENCODE_PERMISSION_KEYS.filter((k) => k !== 'external_directory');
    expect(Object.keys(map).sort()).toEqual([...expected].sort());
  });
});

describe('opencode permission map → Claude 载入集', () => {
  test('三档各自的 --tools 值', () => {
    expect(claudeToolsValue(mapAgentPermissionToClaudeTools(opencodePermissionFor('read-only'))))
      .toBe('Read,Glob,Grep,WebFetch,WebSearch');
    expect(claudeToolsValue(mapAgentPermissionToClaudeTools(opencodePermissionFor('edit'))))
      .toBe('Read,Glob,Grep,Edit,Write,NotebookEdit,WebFetch,WebSearch,Skill');
    expect(claudeToolsValue(mapAgentPermissionToClaudeTools(opencodePermissionFor('full'))))
      .toBe('Read,Glob,Grep,Edit,Write,NotebookEdit,Bash,Task,WebFetch,WebSearch,Skill');
  });

  test("'*' 先定基线，显式键随后覆盖", () => {
    const gate = mapAgentPermissionToClaudeTools({ '*': 'allow', bash: 'deny', edit: 'deny' });
    expect(gate.tools).toEqual(['Read', 'Glob', 'Grep', 'Task', 'WebFetch', 'WebSearch', 'Skill']);
  });

  test("headless 下 'ask' 按 deny 处理并告警", () => {
    const gate = mapAgentPermissionToClaudeTools({ read: 'allow', bash: 'ask' });
    expect(gate.tools).toEqual(['Read']);
    expect(gate.warnings.some((w) => w.includes("'ask'"))).toBe(true);
  });

  test('未知键 fail closed 并告警', () => {
    const gate = mapAgentPermissionToClaudeTools({ read: 'allow', teleport: 'allow' } as Record<string, 'allow'>);
    expect(gate.tools).toEqual(['Read']);
    expect(gate.warnings.some((w) => w.includes('teleport'))).toBe(true);
  });

  test('逐 pattern 规则降级为整工具装载并告警', () => {
    const allowSome = mapAgentPermissionToClaudeTools({ bash: { 'git *': 'allow', '*': 'deny' } });
    expect(allowSome.tools).toEqual(['Bash']);
    expect(allowSome.warnings.some((w) => w.includes('pattern'))).toBe(true);
    const allowNone = mapAgentPermissionToClaudeTools({ bash: { '*': 'deny' } });
    expect(allowNone.tools).toEqual([]);
  });

  test('全 deny 的 map 仍产出空载入集并显式告警', () => {
    const gate = mapAgentPermissionToClaudeTools({ read: 'deny' });
    expect(claudeToolsValue(gate)).toBe('');
    expect(gate.warnings.some((w) => w.includes('未授予任何 claude 内置工具'))).toBe(true);
  });

  test('空 map ⇒ null（调用方回落 bypassPermissions）', () => {
    expect(claudeToolGateFor({})).toBeNull();
    expect(claudeToolGateFor(undefined)).toBeNull();
    expect(claudeToolGateFor({ read: 'allow' })?.tools).toEqual(['Read']);
  });
});
