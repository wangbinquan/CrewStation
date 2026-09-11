import type { CapabilityDescriptionDto } from '@crewstation/contracts';
import type { McpCaller } from '../caller/callerIdentity';
import { callerFromHeaders, requireCaller } from '../caller/callerIdentity';
import { callerProjectResolver } from '../caller/callerProject';
import type { PlatformAccess } from '../caller/platformClient';
import { platformClientFor } from '../caller/platformClient';

export interface CapabilityContext {
  readonly caller: McpCaller | undefined;
  /** 一次请求内多份 resource 共用同一份能力说明，避免一次 resources/read 打一遍 cs-api。 */
  description(): Promise<CapabilityDescriptionDto>;
}

export function capabilityContextFor(access: PlatformAccess, request: Request): CapabilityContext {
  const caller = callerFromHeaders(request.headers);
  let pending: Promise<CapabilityDescriptionDto> | undefined;
  return {
    caller,
    description: () => (pending ??= describe(access, requireCaller(caller))),
  };
}

async function describe(access: PlatformAccess, caller: McpCaller): Promise<CapabilityDescriptionDto> {
  const client = platformClientFor(access, caller);
  const project = await callerProjectResolver(client, caller)();
  return client.capabilities.describe(project.projectId);
}
