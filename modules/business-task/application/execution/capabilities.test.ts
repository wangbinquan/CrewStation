import { expect, test } from 'bun:test';
import { BUSINESS_AGENT_CAPABILITIES } from '../../domain/executionAgent';
import type { ResolvedCompute } from '../../ports/runtime';
import { testedAgentCapabilities } from './capabilities';

const compute = (protocol: ResolvedCompute['protocol'], nativeProbeVersion?: 2): ResolvedCompute => ({ id: Bun.randomUUIDv7(), name: 'profile', revision: 1, image: 'registry.test/runner@sha256:' + 'a'.repeat(64), protocol,
  businessExecution: { protocolVersion: 3, capabilities: BUSINESS_AGENT_CAPABILITIES, ...(nativeProbeVersion ? { nativeProbeVersion } : {}) } });

// RFC-040 V12: a root-only native probe (older proofs) unlocked plugins, inline MCP and sub-agents
// without exercising them, and Claude native paths were never verified. Neither may claim them.
test('native capabilities are claimed only from the full OpenCode native probe', () => {
  expect(testedAgentCapabilities(compute('opencode', 2))).toMatchObject({ nativeConfigVersion: 1, nativeModelMappingVersion: 1, materialObjectsVersion: 1, startupInventoryVersion: 1 });
  for (const value of [testedAgentCapabilities(compute('opencode')), testedAgentCapabilities(compute('claude-code', 2)), testedAgentCapabilities(compute('claude-code'))]) {
    expect(value.nativeConfigVersion).toBeUndefined(); expect(value.nativeModelMappingVersion).toBeUndefined();
    expect(value).toMatchObject({ materialObjectsVersion: 1, events: true, systemPrompt: true, mcp: true });
  }
  expect(testedAgentCapabilities({ ...compute('opencode', 2), businessExecution: undefined }).events).toBe(false);
});
