import { taskStorageCapabilities } from '../storage/storageCapabilities';
import { BUSINESS_EXECUTION_LIMITS } from '@crewstation/contracts';
import type { BusinessAgentCapabilities, BusinessCapabilitiesDto } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { BusinessExecutionApi } from '../../api/executionApi';
import type { ResolvedCompute } from '../../ports/runtime';
import { BUSINESS_AGENT_CAPABILITIES } from '../../domain/executionAgent';
import type { BusinessExecutionDeps } from './dependencies';
import { executionSource } from './source';

const unavailable: BusinessAgentCapabilities = { events: false, usage: 'none', resume: false, systemPrompt: false, skills: false, mcp: false, platformDelegation: false, opaqueInternalDelegation: false };
/** Only tested capabilities from the exact immutable compute revision may be used for admission. */
export function testedAgentCapabilities(compute: ResolvedCompute): BusinessAgentCapabilities {
  const proof = compute.businessExecution;
  if (!proof || proof.protocolVersion !== 3) return { ...unavailable };
  const supported = proof.capabilities, implemented = BUSINESS_AGENT_CAPABILITIES;
  return { events: supported.events && implemented.events, usage: !implemented.events ? 'none' : supported.usage,
    resume: supported.resume && implemented.resume, systemPrompt: supported.systemPrompt && implemented.systemPrompt,
    skills: supported.skills && implemented.skills, mcp: supported.mcp && implemented.mcp,
    platformDelegation: supported.platformDelegation && implemented.platformDelegation, opaqueInternalDelegation: supported.opaqueInternalDelegation && implemented.opaqueInternalDelegation };
}
export function requireBusinessAgent(compute: ResolvedCompute): BusinessAgentCapabilities {
  const capabilities = testedAgentCapabilities(compute);
  if (!capabilities.events) throw precondition('固定档位修订尚未通过可靠业务执行测试，请重测档位镜像', { code: 'unsupported_capability', capability: 'businessExecutionV3' });
  return capabilities;
}
export function executionCapabilities(deps: BusinessExecutionDeps): Pick<BusinessExecutionApi, 'capabilities'> {
  const source = executionSource(deps);
  return { capabilities: async (caller): Promise<BusinessCapabilitiesDto> => {
    const context = await source(caller), agentProfiles: BusinessCapabilitiesDto['agentProfiles'] = [];
    for (const profile of context.registration.tasksSpec!.agentProfiles) {
      const compute = await deps.compute.resolve(profile.compute, 'subtask', context.projectId);
      agentProfiles.push({ agentProfileId: profile.id, computeProfileId: compute.id, profileRevision: compute.revision, capabilities: testedAgentCapabilities(compute) });
    }
    return { protocolVersion: 3, releaseId: context.authority.releaseId, limits: BUSINESS_EXECUTION_LIMITS, storage: await taskStorageCapabilities(deps, context.serviceId), agentProfiles };
  } };
}
