import { randomBytes } from 'node:crypto';
import { BusinessCommandSecretEnvironmentSchema, BusinessRenderedCommandEnvironmentSchema, SubmitBusinessSubtaskV3Schema, businessCommandDigestInput } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { BusinessExecutionDeps } from '../dependencies';
import type { ExecutionOperation } from '../../../domain/taskAdmission';
import { authorizeCommandEnvironment, type CommandRequest, type ExecutionCommandPlan } from '../../../domain/executionCommand';

export function readCommandPlan(stored: unknown): CommandRequest | ExecutionCommandPlan {
  if (stored && typeof stored === 'object' && 'kind' in stored && stored.kind === 'command-plan') {
    const plan = stored as ExecutionCommandPlan, request = SubmitBusinessSubtaskV3Schema.parse(plan.request);
    if (request.kind !== 'command') throw precondition('命令计划类型不一致', { code: 'invalid_configuration' });
    const secretEnvironment = BusinessCommandSecretEnvironmentSchema.parse(plan.secretEnvironment);
    const requested = Object.entries(request.env).filter(([, value]) => typeof value !== 'string');
    if (requested.length !== Object.keys(secretEnvironment.references).length || requested.some(([name, value]) => typeof value === 'string' || secretEnvironment.references[name] !== value.secret.configDefinitionId)) throw precondition('命令 Secret 计划不一致', { code: 'invalid_configuration' });
    return { ...plan, request, secretEnvironment };
  }
  const request = SubmitBusinessSubtaskV3Schema.parse(stored);
  if (request.kind !== 'command' || Object.values(request.env).some((value) => typeof value !== 'string')) throw precondition('命令未固定 Secret 版本', { code: 'invalid_configuration' });
  return request;
}
export async function renderCommand(deps: BusinessExecutionDeps, stored: CommandRequest | ExecutionCommandPlan) {
  const plan = stored.kind === 'command-plan' ? stored : undefined, request = plan?.request ?? stored as CommandRequest;
  if (plan && !deps.agentSecrets) throw precondition('项目 Secret 版本已不可用', { code: 'secret_version_unavailable' });
  let values: Record<string, string> = {};
  try { if (plan) values = await deps.agentSecrets!.render(plan.projectId, plan.secretEnvironment.versions); } catch { throw precondition('项目 Secret 固定版本不可用', { code: 'secret_version_unavailable' }); }
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.env)) {
    const resolved = typeof value === 'string' ? value : values[value.secret.configDefinitionId];
    if (resolved === undefined) throw precondition('项目 Secret 版本已不可用', { code: 'secret_version_unavailable' });
    env[name] = resolved;
  }
  const parsed = BusinessRenderedCommandEnvironmentSchema.safeParse(env);
  if (!parsed.success) throw precondition('固定 Secret 值不能用于命令环境', { code: 'invalid_configuration' });
  return { command: request.argv, cwd: request.cwd, env: parsed.data, timeoutSeconds: request.timeoutSeconds, ...(plan ? { secretEnvironment: plan.secretEnvironment } : {}) };
}
export async function prepareCommandPlan(deps: BusinessExecutionDeps, parent: ExecutionOperation, request: CommandRequest, info: { commandSecretEnvVersion?: 1 }) {
  const references = authorizeCommandEnvironment(parent.intent.tasksSpec, request);
  let plan: CommandRequest | ExecutionCommandPlan = request;
  if (Object.keys(references).length) {
    if (info.commandSecretEnvVersion !== 1 || !deps.agentSecrets) throw precondition('运行环境不支持命令 Secret', { code: 'unsupported_capability', capability: 'commandSecretEnvVersion' });
    const versions = await deps.agentSecrets.versions(parent.intent.projectId, [...new Set(Object.values(references))].sort());
    plan = { kind: 'command-plan', projectId: parent.intent.projectId, request, secretEnvironment: BusinessCommandSecretEnvironmentSchema.parse({ version: 1, nonce: randomBytes(32).toString('hex'), references, versions }) };
  }
  const command = await renderCommand(deps, plan);
  return { plan, payloadDigest: new Bun.CryptoHasher('sha256').update(businessCommandDigestInput(command)).digest('hex') };
}
