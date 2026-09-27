import type { AgentProfile, BusinessAgentCapabilities, BusinessMaterialRequest, McpConnection } from '@crewstation/contracts';
import { precondition, validation } from '@crewstation/kernel';

type Material = Omit<BusinessMaterialRequest, 'requestKey' | 'fence'>;
/** Validate only the immutable parent release. A newer registration cannot grant permissions to an old task. */
export function validateBusinessMaterial(profile: AgentProfile, material: Material, capabilities: BusinessAgentCapabilities, platform: { reservedEnv: readonly string[]; mcp: readonly McpConnection[] }, parentProfiles: readonly AgentProfile[]): void {
  const policy = profile.businessConfig;
  const unsupported = (name: string) => { throw precondition(`档位不支持 ${name}`, { code: 'unsupported_capability', capability: name }); };
  const denied = (name: string) => { throw validation(`发布契约未允许 ${name}`, { code: 'invalid_configuration' }); };
  if (material.systemPrompt) { if (!capabilities.systemPrompt) unsupported('systemPrompt'); if (!policy?.allowSystemPromptAppend) denied('systemPrompt'); }
  if (material.skills.length) { if (!capabilities.skills) unsupported('skills'); if (!policy?.allowSkills) denied('skills'); }
  for (const key of Object.keys(material.env)) if (!policy?.allowedEnvNames.includes(key) || platform.reservedEnv.includes(key)) denied(`env.${key}`);
  if (material.mcp.length && !capabilities.mcp) unsupported('mcp');
  for (const requested of material.mcp) {
    const connection = policy?.mcpConnections.find((entry) => entry.id === requested.connectionId);
    if (!connection) denied(`mcp.${requested.connectionId}`);
    if (platform.mcp.some((entry) => entry.name === connection!.name)) denied(`平台 MCP 重名 ${connection!.name}`);
    if (Object.keys(requested.parameters).some((key) => !connection!.allowedParameterKeys.includes(key))) denied('MCP 参数');
  }
  if (material.subagents.length && !capabilities.platformDelegation) unsupported('platformDelegation');
  for (const agent of material.subagents) if (!parentProfiles.some((entry) => entry.id === agent.agentProfileId)) denied(`subagent.${agent.name}`);
}

export function materialSecretReferences(material: Material, profile: AgentProfile): string[] {
  const ids = Object.values(material.env).flatMap((value) => typeof value === 'string' ? [] : [value.secret.configDefinitionId]);
  for (const selected of material.mcp) {
    const connection = profile.businessConfig?.mcpConnections.find((entry) => entry.id === selected.connectionId);
    if (connection) ids.push(...Object.values(connection.secretHeaders));
  }
  return [...new Set(ids)].sort();
}
