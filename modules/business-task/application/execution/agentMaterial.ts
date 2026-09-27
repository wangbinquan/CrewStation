import { businessAgentDigestInput } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { ExecutionAgentPlan } from '../../domain/executionAgent';
import type { BusinessExecutionDeps } from './dependencies';

export function agentPayloadDigest(command: ExecutionAgentPlan['command'], nonce: string): string {
  return new Bun.CryptoHasher('sha256').update(businessAgentDigestInput(command, nonce)).digest('hex');
}
/** Resolve only pinned project versions. A changed provider credential cannot silently alter a previously admitted attempt. */
export async function agentCommand(deps: BusinessExecutionDeps, plan: ExecutionAgentPlan, providerSecrets?: Record<string, string>): Promise<ExecutionAgentPlan['command']> {
  const ref = { profileId: plan.compute.id, revision: plan.compute.revision };
  const provider = providerSecrets ?? (await (plan.credentialStamp && deps.compute.launchMaterialAt ? deps.compute.launchMaterialAt(ref, plan.credentialStamp) : deps.compute.launchMaterial(ref))).beforeStart.secrets;
  if (plan.secretVersions.length && !deps.agentSecrets) throw precondition('项目 Secret 版本已不可用', { code: 'secret_version_unavailable' });
  const values = plan.secretVersions.length ? await deps.agentSecrets!.render(plan.projectId, plan.secretVersions) : {};
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(plan.material.env)) {
    const resolved = typeof value === 'string' ? value : values[value.secret.configDefinitionId];
    if (resolved === undefined) throw precondition('项目 Secret 版本已不可用', { code: 'secret_version_unavailable' });
    env[key] = resolved;
  }
  const mcp = plan.command.mcp.map((entry) => {
    const refs = plan.secretMcp.find((selected) => selected.name === entry.name)?.headers ?? {}, headers = { ...entry.headers };
    for (const [key, id] of Object.entries(refs)) {
      if (values[id] === undefined) throw precondition('MCP Secret 版本已不可用', { code: 'secret_version_unavailable' });
      headers[key] = values[id]!;
    }
    return { ...entry, headers };
  });
  return { ...plan.command, beforeStart: { ...plan.command.beforeStart, secrets: provider }, env, mcp };
}
