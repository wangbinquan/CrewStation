import { describe, expect, test } from 'bun:test';
import { DevelopmentUsageAdmissionSchema, StartAgentCommandSchema, TaskIdSchema, ProjectIdSchema } from '@crewstation/contracts';
import { developmentIntentDigest, validateDevelopmentStart } from './developmentStartIntent';

const id = (n: number) => `019f0000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const intent = { version: 1 as const, identity: { sourceKind: 'development-agent' as const, projectId: ProjectIdSchema.parse(id(1)), taskId: TaskIdSchema.parse(id(2)), executionId: id(3), executionGeneration: 1 as const, agentId: id(4) },
  profileId: id(5), profileRevision: 2, launch: { protocol: 'opencode' as const, binaryPath: '/usr/bin/opencode', extraArgs: [], isSandbox: false }, permission: 'full' as const, mode: 'interactive' as const,
  initialPrompt: 'fixed-prompt', cwd: null, resumeSessionId: null, systemPrompt: null, mcp: [{ name: 'platform', url: 'http://mcp.example.test/' }], nativeUsageLineageKey: 'real-source-lineage' };
const original = { intent, digestNonce: 'a'.repeat(64) };
const admission = DevelopmentUsageAdmissionSchema.parse({ ...original, key: { executionId: id(3), incarnation: '7c8d69dc-ccf9-4f85-9f54-dd0c1c1bc944', journalId: '2df8e781-61f9-40ce-a9ba-b2b470ad64b0', payloadDigest: developmentIntentDigest(original) } });
const command = () => StartAgentCommandSchema.parse({ id: 'start', type: 'startAgent', agentId: id(4), compute: 'Named compute', profileRevision: 2, launch: intent.launch, permission: 'full', mode: 'interactive', initialPrompt: intent.initialPrompt,
  mcp: [{ ...intent.mcp[0], headers: { authorization: 'first-signed-token' } }], beforeStart: { profile: id(5), revision: 2, contentHash: 'fixed-template-hash', steps: [], secrets: {}, vars: {}, configFile: { kind: 'none' } }, env: {}, processAttemptId: 'fixed-process-attempt' });

describe('RFC-034 stable development start intent', () => {
  test('re-signed MCP headers and launch materials do not redefine the accepted execution', () => {
    const initial = command();
    expect(validateDevelopmentStart(initial, admission)).toEqual(admission);
    const refreshed = { ...initial, mcp: initial.mcp.map((m) => ({ ...m, headers: { authorization: 'refreshed-signed-token' } })), env: { TEMP_TOKEN: 'refreshed' } };
    expect(validateDevelopmentStart(refreshed, admission)).toEqual(admission);
    expect(() => validateDevelopmentStart({ ...initial, initialPrompt: 'different-prompt' }, admission)).toThrow('固定的意图');
    expect(() => validateDevelopmentStart({ ...initial, launch: { ...initial.launch, binaryPath: '/different-cli' } }, admission)).toThrow('固定的意图');
    expect(() => validateDevelopmentStart({ ...initial, beforeStart: { ...initial.beforeStart, revision: 3 } }, admission)).toThrow('固定的意图');
    expect(() => validateDevelopmentStart(initial, { ...admission, digestNonce: 'b'.repeat(64) })).toThrow('固定的意图');
  });
});
