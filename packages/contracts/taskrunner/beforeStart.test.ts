import { describe, expect, test } from 'bun:test';
import { BEFORE_START_LIMITS, BeforeStartStepsSchema, ScriptStepSchema } from './beforeStart';
import { parseTemplateReference, renderTemplate, scanTemplate } from './beforeStartTemplate';

describe('启动前 Hook 契约', () => {
  test('步骤表：stepId 唯一、脚本超时之和受上限、custom 必须给解释器、默认值补齐', () => {
    const step = ScriptStepSchema.parse({ kind: 'script', stepId: 'a', name: 'a', language: 'shell', source: 'true' });
    expect(step).toMatchObject({ timeoutMs: BEFORE_START_LIMITS.defaultScriptTimeoutMs, argv: [] });
    expect(ScriptStepSchema.safeParse({ kind: 'script', stepId: 'a', name: 'a', language: 'custom', source: 'x' }).success).toBe(false);
    expect(BeforeStartStepsSchema.safeParse([step, { ...step }]).success).toBe(false);
    const heavy = Array.from({ length: 4 }, (_, i) => ({ ...step, stepId: `s${i}`, timeoutMs: BEFORE_START_LIMITS.maxScriptTimeoutMs }));
    expect(BeforeStartStepsSchema.safeParse(heavy).success).toBe(false);
    expect(BeforeStartStepsSchema.safeParse(heavy.slice(0, 3)).success).toBe(true);
  });
  test('模板变量：识别四类命名空间，未知命名空间与非法名字为 undefined，渲染按 token 顺序求值', () => {
    expect(parseTemplateReference('agent.home')).toEqual({ kind: 'context', name: 'agent.home' });
    expect(parseTemplateReference('vars.API_BASE')).toEqual({ kind: 'vars', name: 'API_BASE' });
    expect(parseTemplateReference('secrets.k')).toEqual({ kind: 'secrets', name: 'k' });
    expect(parseTemplateReference('env.9bad')).toBeUndefined();
    expect(parseTemplateReference('other.X')).toBeUndefined();
    expect(scanTemplate('{{ vars.A }}/{{agent.id}}/{{nope}}').map((t) => t.reference?.kind ?? 'unknown')).toEqual(['vars', 'context', 'unknown']);
    expect(renderTemplate('{{vars.A}}-{{agent.id}}', (ref) => (ref.kind === 'context' ? 'agent' : 'a'))).toBe('a-agent');
    expect(() => renderTemplate('{{bogus.X}}', () => '')).toThrow('无法识别');
  });
});
