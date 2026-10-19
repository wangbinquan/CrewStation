import { randomBytes } from 'node:crypto';
import { BusinessCommandSecretEnvironmentSchema, BusinessExecutionInfoSchema, BusinessExecutionReceiptSchema, BusinessRenderedCommandEnvironmentSchema, SubmitBusinessSubtaskV3Schema, businessCommandDigestInput } from '@crewstation/contracts';
import type { RunnerBusinessReceipt } from '@crewstation/contracts';
import { isPlatformError, newResourceId, precondition } from '@crewstation/kernel';
import type { ExecutionSubtask } from '../../domain/executionSubtask';
import type { ExecutionOperation } from '../../domain/taskAdmission';
import { authorizeCommandEnvironment, type CommandRequest, type ExecutionCommandPlan } from '../../domain/executionCommand';
import type { BusinessExecutionDeps } from './dependencies';

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
const errorCode = (error: unknown): string | undefined => isPlatformError(error) ? String(error.details?.code ?? error.kind) : undefined;

/** Reconcile the original execution before any retry. Persist incarnation before writing the start RPC. */
export async function dispatchBusinessCommand(deps: BusinessExecutionDeps, claimed: ExecutionSubtask): Promise<void> {
  let incarnation = claimed.incarnation;
  try {
    const env = await deps.environments.getEnvironment(claimed.taskId);
    if (env?.state !== 'running' || !env.connected) {
      await deps.subtasks.settle(claimed, { dispatch: incarnation ? 'unknown' : 'pending', view: claimed.view }); return;
    }
    const receipt = await readReceipt(deps, claimed);
    if (receipt) { await acceptReceipt(deps, claimed, receipt); return; }
    const info = BusinessExecutionInfoSchema.parse(await deps.runner.sendCommand(claimed.runtimeTaskId ?? claimed.taskId, { id: newResourceId(), type: 'businessExecutionInfo' }));
    if (incarnation && incarnation !== info.incarnation) {
      await unknown(deps, claimed, 'execution_incarnation_changed'); return;
    }
    const plan = readCommandPlan(JSON.parse(await deps.cipher.open(claimed.sealedPayload)));
    if (plan.kind === 'command-plan' && info.commandSecretEnvVersion !== 1) throw precondition('Runner 未声明命令 Secret 能力', { code: 'unsupported_capability' });
    const command = await renderCommand(deps, plan);
    if (!await deps.subtasks.checkpoint(claimed, info.incarnation)) return;
    incarnation = info.incarnation;
    const result = BusinessExecutionReceiptSchema.parse(await deps.runner.sendCommand(claimed.runtimeTaskId ?? claimed.taskId, {
      id: newResourceId(), type: 'startBusinessCommand', executionId: claimed.view.executionId, attempt: claimed.view.attempt,
      incarnation, payloadDigest: claimed.payloadDigest, ...command,
    }));
    await acceptReceipt(deps, { ...claimed, incarnation }, result);
  } catch (error) {
    const code = errorCode(error);
    // Only a pre-start capability/config rejection proves no process was admitted.
    if (!incarnation && ['unsupported_capability', 'unsupported_runner', 'invalid_configuration', 'secret_version_unavailable'].includes(code ?? '')) {
      await deps.subtasks.failBeforeStart(claimed, { error: { code: code!, message: '运行环境不支持该执行' } });
    } else if (!incarnation) {
      await deps.subtasks.settle(claimed, { dispatch: 'pending', view: claimed.view });
    } else await unknown(deps, claimed, code ?? 'dispatch_unknown');
  }
}
export async function readReceipt(deps: BusinessExecutionDeps, claimed: ExecutionSubtask): Promise<RunnerBusinessReceipt | undefined> {
  if (!claimed.incarnation) return undefined;
  try { return BusinessExecutionReceiptSchema.parse(await deps.runner.sendCommand(claimed.runtimeTaskId ?? claimed.taskId, { id: newResourceId(), type: 'getBusinessExecution', executionId: claimed.view.executionId })); }
  catch (error) { if (errorCode(error) === 'execution_not_found') return undefined; throw error; }
}
export async function acceptReceipt(deps: BusinessExecutionDeps, claimed: ExecutionSubtask, receipt: RunnerBusinessReceipt): Promise<void> {
  if (receipt.executionId !== claimed.view.executionId || receipt.attempt !== claimed.view.attempt || receipt.payloadDigest !== claimed.payloadDigest || receipt.incarnation !== claimed.incarnation) {
    await unknown(deps, claimed, 'execution_identity_conflict'); return;
  }
  const state = receipt.phase === 'finished' ? 'verifying' : receipt.phase === 'cancelling' ? 'cancelling' : receipt.phase === 'registered' ? 'pending' : 'running';
  await deps.subtasks.settle(claimed, { ...(claimed.runtimeAdmitted ? { runtimeAdmitted: true } : {}), dispatch: receipt.phase === 'unknown' ? 'unknown' : 'accepted', receipt,
    view: { ...claimed.view, state, process: receipt.phase === 'unknown' ? 'unknown' : receipt.phase === 'finished' ? 'exited' : receipt.phase === 'registered' ? 'not-started' : 'live',
      ...(receipt.phase === 'unknown' ? { error: { code: 'execution_unknown', message: '执行结果尚不可证明' } } : { error: undefined }) } });
}
export async function unknown(deps: BusinessExecutionDeps, claimed: ExecutionSubtask, code: string): Promise<void> {
  await deps.subtasks.settle(claimed, { dispatch: 'unknown', view: { ...claimed.view, state: 'running', process: 'unknown', error: { code, message: '保留原执行句柄，等待可靠回执' } } });
}
