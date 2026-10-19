import { taskStorageCapabilities } from '../storage/storageCapabilities';
import { BUSINESS_EXECUTION_LIMITS, BUSINESS_NATIVE_MATERIAL_LIMITS } from '@crewstation/contracts';
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
  // RFC-040 V12: native material is claimed only from the full OpenCode probe; Claude native paths are not verified.
  const supported = proof.capabilities, implemented = BUSINESS_AGENT_CAPABILITIES, native = proof.nativeProbeVersion === 2 && compute.protocol === 'opencode';
  return { ...(native && supported.nativeModelMappingVersion === 1 && implemented.nativeModelMappingVersion === 1 ? { nativeModelMappingVersion: 1 as const } : {}), ...(native && supported.nativeConfigVersion === 1 && implemented.nativeConfigVersion === 1 ? { nativeConfigVersion: 1 as const } : {}), ...(supported.materialObjectsVersion === 1 && implemented.materialObjectsVersion === 1 ? { materialObjectsVersion: 1 as const } : {}), ...(supported.startupInventoryVersion === 1 && implemented.startupInventoryVersion === 1 ? { startupInventoryVersion: 1 as const } : {}), events: supported.events && implemented.events, usage: !implemented.events ? 'none' : supported.usage,
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
    // RFC-043: a service compares its tasks' pins with the version its own release declares.
    const upgrade = deps.runtimeImages?.versionImage && deps.environments.repinPausedBusinessWorkspace ? { runtimeImageUpgrade: 1 as const, taskRuntimeImageVersionId: context.registration.tasksSpec!.runtimeImageVersionId ?? null } : {};
    return { ...(deps.agentSecrets ? { commandSecretEnvVersion: 1 as const } : {}), ...(deps.materialObjects ? { nativeMaterialLimits: BUSINESS_NATIVE_MATERIAL_LIMITS } : {}), ...upgrade, protocolVersion: 3, releaseId: context.authority.releaseId, limits: BUSINESS_EXECUTION_LIMITS, storage: await taskStorageCapabilities(deps, context.serviceId), agentProfiles };
  } };
}
