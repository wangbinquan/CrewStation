import { describe, expect, test } from 'bun:test';
import { CreateBusinessTaskV3Schema, SubmitBusinessSubtaskV3Schema, RetryBusinessSubtaskV3Schema } from './requests';
import { BusinessMaterialRequestSchema } from './materials';
import { BusinessFileQuerySchema } from './files';
import { BusinessControlClaimSchema } from './control';

const profile = '01a0bf5d-8f4b-7000-8000-000000000001';
const agent = { requestKey: 'task:42:analysis:1', kind: 'agent', name: 'analysis', agentProfileId: profile, prompt: 'review', cwd: '/work/iso/analysis' };

describe('RFC-027 v3 business boundary', () => {
  test('agent invocation preserves resume and material references and rejects silently ignored configuration', () => {
    const parsed = SubmitBusinessSubtaskV3Schema.parse({ ...agent, resumeSessionId: 'native-session', materialId: profile });
    expect(parsed).toMatchObject({ resumeSessionId: 'native-session', materialId: profile, mode: 'oneshot' });
    for (const extra of [{ model: 'uncontrolled' }, { env: { PROVIDER_API_KEY: 'secret' } }, { systemPrompt: 'not-a-material' }]) {
      expect(SubmitBusinessSubtaskV3Schema.safeParse({ ...agent, ...extra }).success).toBe(false);
    }
  });

  test('creation leaves release defaults unresolved and requires an idempotency key and task contract', () => {
    expect(CreateBusinessTaskV3Schema.parse({ requestKey: 'create-1', taskContractVersion: 'aw/1' })).not.toHaveProperty('volumeMode');
    for (const input of [{ taskContractVersion: 'aw/1' }, { requestKey: '' }, { requestKey: 'create-1', taskContractVersion: 'aw/1', releaseId: profile }]) {
      expect(CreateBusinessTaskV3Schema.safeParse(input).success).toBe(false);
    }
  });

  test('command accepts bounded runtime and env but cannot escape the workspace', () => {
    const input = { requestKey: 'clone-1', kind: 'command', name: 'clone', argv: ['git', 'status'], env: { LANG: 'C' }, cwd: '/work/repo' };
    expect(SubmitBusinessSubtaskV3Schema.parse(input)).toMatchObject({ timeoutSeconds: 3600, env: { LANG: 'C' } });
    for (const patch of [{ cwd: '/etc' }, { cwd: '/work/../etc' }, { cwd: '/work/.crewstation/state' }, { argv: [] }, { timeoutSeconds: 86401 }]) {
      expect(SubmitBusinessSubtaskV3Schema.safeParse({ ...input, ...patch }).success).toBe(false);
    }
  });

  test('commands and materials reject reserved environment names and binary argument terminators', () => {
    const command = { requestKey: 'safe-command', kind: 'command', name: 'command', argv: ['true'] };
    for (const name of ['CS_TASK_ID', 'CS_RUNNER_TOKEN', 'HOME', 'PATH', 'XDG_CONFIG_HOME', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENCODE_CONFIG']) {
      expect(SubmitBusinessSubtaskV3Schema.safeParse({ ...command, env: { [name]: 'never-echo' } }).success).toBe(false);
      expect(BusinessMaterialRequestSchema.safeParse({ requestKey: 'material', env: { [name]: 'never-echo' } }).success).toBe(false);
    }
    expect(SubmitBusinessSubtaskV3Schema.safeParse({ ...command, argv: ['sh', 'value\0tail'] }).success).toBe(false);
    expect(SubmitBusinessSubtaskV3Schema.safeParse({ ...command, env: { SAFE: 'value\0tail' } }).success).toBe(false);
    expect(SubmitBusinessSubtaskV3Schema.safeParse({ ...command, argv: Array(1024).fill('arg'), env: { BUSINESS_VALUE: 'ok' } }).success).toBe(true);
  });

  test('fresh retry cannot pretend to restore a session, resume names the original session', () => {
    expect(RetryBusinessSubtaskV3Schema.safeParse({ requestKey: 'r1', expectedAttempt: 1, resumePolicy: 'resume' }).success).toBe(false);
    expect(RetryBusinessSubtaskV3Schema.parse({ requestKey: 'r1', expectedAttempt: 1, resumePolicy: 'resume', resumeSessionId: 'native-session' }).resumePolicy).toBe('resume');
    expect(RetryBusinessSubtaskV3Schema.safeParse({ requestKey: 'r1', expectedAttempt: 1, resumePolicy: 'fresh', resumeSessionId: 'native-session' }).success).toBe(false);
  });

  test('materials reject path escape, duplicated skills and raw MCP credentials', () => {
    const base = { requestKey: 'm1', skills: [{ path: 'review/SKILL.md', content: 'Review carefully' }] };
    expect(BusinessMaterialRequestSchema.parse(base).skills).toHaveLength(1);
    for (const patch of [{ skills: [{ path: '../SKILL.md', content: 'x' }] }, { skills: [...base.skills, ...base.skills] }, { mcp: [{ connectionId: profile, headers: { Authorization: 'secret' } }] }]) {
      expect(BusinessMaterialRequestSchema.safeParse({ ...base, ...patch }).success).toBe(false);
    }
    expect(BusinessMaterialRequestSchema.safeParse({ requestKey: 'm2', systemPrompt: '界'.repeat(400_000) }).success).toBe(false);
  });

  test('file reads bound memory and require a version on subsequent chunks', () => {
    expect(BusinessFileQuerySchema.parse({ path: 'report.json' })).toMatchObject({ offset: 0, limit: 1048576 });
    for (const patch of [{ path: '/etc/passwd' }, { path: '.crewstation/receipt' }, { offset: 1 }, { limit: 1048577 }]) {
      expect(BusinessFileQuerySchema.safeParse({ path: 'report.json', ...patch }).success).toBe(false);
    }
    expect(BusinessFileQuerySchema.safeParse({ path: 'report.json', offset: 100, version: 'a'.repeat(64) }).success).toBe(true);
  });

  test('claim uses an instance ID and cannot supply a trusted active release or epoch', () => {
    expect(BusinessControlClaimSchema.parse({ instanceId: profile })).toEqual({ instanceId: profile });
    expect(BusinessControlClaimSchema.safeParse({ instanceId: profile, activeReleaseId: profile }).success).toBe(false);
  });
});
