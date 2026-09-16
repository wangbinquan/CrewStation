import { describe, expect, test } from 'bun:test';
import type { BeforeStartStep } from '@crewstation/contracts';
import { planCredentialWrites } from '../domain/credentialWrites';
import { presetContent } from '../domain/presets';
import { assertJsonTemplate, placeholdersInsideStrings, stripJsonComments, validateRevisionContent } from '../domain/revisionValidation';
import type { RuntimeRevisionContent } from '../domain/runtimeConfig';
import { contentHashOf } from '../domain/runtimeConfig';
import { checkUsableFor, initialStages } from '../domain/runtimeCheck';
import type { RuntimeCheck } from '../domain/runtimeCheck';

const file = (patch: Partial<Extract<BeforeStartStep, { kind: 'file' }>> = {}): BeforeStartStep => ({ kind: 'file', stepId: 'f', name: 'f', pathTemplate: '{{agent.home}}/.claude/settings.json', contentTemplate: '{"env":{"K":"{{vars.K}}"}}', format: 'json', mode: 0o600, existing: 'require-same', ...patch });
const script = (patch: Partial<Extract<BeforeStartStep, { kind: 'script' }>> = {}): BeforeStartStep => ({ kind: 'script', stepId: 's', name: 's', language: 'shell', source: 'true', argv: [], timeoutMs: 1000, ...patch });
const content = (steps: BeforeStartStep[], patch: Partial<RuntimeRevisionContent> = {}): RuntimeRevisionContent => ({ steps, vars: { K: 'v' }, secretNames: ['TOKEN'], configFile: { kind: 'none' }, models: [], ...patch });
const messageOf = (fn: () => void) => { try { fn(); return undefined; } catch (e) { return e as { message: string; details: Record<string, unknown> }; } };

describe('运行环境版本的保存校验', () => {
  test('两个预设通过校验；空白预设无步骤；预设与驱动不匹配被拒', () => {
    expect(() => validateRevisionContent(presetContent('claude-settings', 'claude-code'))).not.toThrow();
    expect(() => validateRevisionContent(presetContent('opencode-config', 'opencode'))).not.toThrow();
    expect(presetContent('blank', 'opencode').steps).toEqual([]);
    expect(() => presetContent('claude-settings', 'opencode')).toThrow('只适用于 claude-code');
  });
  test('未声明变量、保留名、env 只能引用之前脚本、路径形态与 JSON 结构逐项定位到步骤与字段', () => {
    expect(messageOf(() => validateRevisionContent(content([file({ contentTemplate: '{"x":"{{vars.NOPE}}"}' })])))).toMatchObject({ details: { stepId: 'f', field: 'contentTemplate' } });
    expect(messageOf(() => validateRevisionContent(content([file({ contentTemplate: '{"x":"{{env.FROM}}"}' })])))?.message).toContain('之前脚本步骤');
    expect(() => validateRevisionContent(content([script({ stepId: 'a' }), file({ contentTemplate: '{"x":"{{env.FROM}}"}' })]))).not.toThrow();
    expect(messageOf(() => validateRevisionContent(content([file()], { vars: { HOME: '/x' } })))).toMatchObject({ details: { field: 'vars.HOME' } });
    expect(messageOf(() => validateRevisionContent(content([file()], { secretNames: ['K'] })))?.message).toContain('同时出现');
    expect(messageOf(() => validateRevisionContent(content([file({ pathTemplate: 'relative/path.json' })])))).toMatchObject({ details: { stepId: 'f', field: 'pathTemplate' } });
    expect(messageOf(() => validateRevisionContent(content([file({ pathTemplate: '/etc/../x' })])))?.message).toContain('..');
    expect(() => validateRevisionContent(content([file({ pathTemplate: '~/.claude/settings.json' })]))).not.toThrow();
    expect(messageOf(() => validateRevisionContent(content([file({ contentTemplate: '{"x": {{vars.K}} }' })])))?.message).toContain('字符串值');
    expect(messageOf(() => validateRevisionContent(content([file({ contentTemplate: '{bad' })])))?.message).toContain('不是合法文档');
    expect(() => validateRevisionContent(content([file({ format: 'jsonc', contentTemplate: '{ // note\n "x": "{{secrets.TOKEN}}" }' })]))).not.toThrow();
    expect(messageOf(() => validateRevisionContent(content([script({ language: 'custom', interpreter: ['tool'] })])))?.message).toContain('绝对路径');
    expect(messageOf(() => validateRevisionContent(content([file()], { configFile: { kind: 'claude-settings', pathTemplate: '{{agent.home}}/other.json' } })))?.message).toContain('没有对应的文件步骤');
    expect(() => validateRevisionContent(content([file()], { configFile: { kind: 'claude-settings', pathTemplate: '{{agent.home}}/.claude/settings.json' } }))).not.toThrow();
    expect(messageOf(() => validateRevisionContent(content([file()], { defaultModel: 'a', models: ['b'] })))).toMatchObject({ details: { field: 'defaultModel' } });
  });
  test('JSONC 注释剥离与占位位置检查', () => {
    expect(stripJsonComments('{"a": "http://x//y", /* c */ "b": 1 // tail\n}').replace(/\s/g, '')).toBe('{"a":"http://x//y","b":1}');
    expect(placeholdersInsideStrings('{"a":"{{vars.X}}"}')).toBe(true);
    expect(placeholdersInsideStrings('{"a":{{vars.X}}}')).toBe(false);
    expect(() => assertJsonTemplate('{"a":"{{vars.X}}"}', 'json', 's')).not.toThrow();
  });
  test('contentHash 对键顺序不敏感、对步骤顺序敏感', () => {
    const a = content([script({ stepId: 'a' }), script({ stepId: 'b' })], { vars: { A: '1', B: '2' } });
    const b = content([script({ stepId: 'a' }), script({ stepId: 'b' })], { vars: { B: '2', A: '1' } });
    const c = content([script({ stepId: 'b' }), script({ stepId: 'a' })], { vars: { A: '1', B: '2' } });
    expect(contentHashOf(a)).toBe(contentHashOf(b));
    expect(contentHashOf(a)).not.toBe(contentHashOf(c));
  });
  test('凭据写操作：keep 只对已有值；clear 未设置无副作用；未声明的名字被拒', () => {
    const plan = planCredentialWrites(new Set(['A']), ['A', 'B', 'C'], { A: { op: 'keep' }, B: { op: 'replace', value: 'x' }, C: { op: 'clear' } });
    expect(plan).toEqual({ replace: [{ name: 'B', value: 'x' }], clear: [] });
    expect(() => planCredentialWrites(new Set(), ['A'], { A: { op: 'keep' } })).toThrow('尚未设置');
    expect(() => planCredentialWrites(new Set(), ['A'], { Z: { op: 'replace', value: 'x' } })).toThrow('未在 secretNames');
    expect(planCredentialWrites(new Set(['OLD']), ['A'], { OLD: { op: 'clear' } })).toEqual({ replace: [], clear: ['OLD'] });
  });
  test('检查阶段表与启用判定', () => {
    const revision = { ...content([script({ stepId: 'a' })]), configId: 'arc_x' as never, revision: 2, contentHash: 'h', createdBy: 'usr_x' as never, createdAt: new Date() };
    expect(initialStages(revision).map((s) => s.id)).toEqual(['input', 'step:a', 'cli-config', 'model']);
    const check: RuntimeCheck = { checkId: 'chk_x' as never, configId: 'arc_x' as never, revision: 2, contentHash: 'h', clientRequestId: 'r', createdBy: 'usr_x' as never, state: 'succeeded', context: { kind: 'platform-namespace' }, stages: [], createdAt: new Date() };
    expect(checkUsableFor(check, revision)).toEqual({ ok: true });
    expect(checkUsableFor({ ...check, contentHash: 'other' }, revision)).toMatchObject({ ok: false });
    expect(checkUsableFor({ ...check, state: 'failed' }, revision)).toMatchObject({ ok: false });
    expect(checkUsableFor(undefined, revision)).toMatchObject({ ok: false });
  });
});
