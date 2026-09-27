import { BusinessExecutionInfoSchema, BusinessExecutionReceiptSchema, SubmitBusinessSubtaskV3Schema } from '@crewstation/contracts';
import type { RunnerBusinessReceipt } from '@crewstation/contracts';
import { isPlatformError, newResourceId } from '@crewstation/kernel';
import type { ExecutionSubtask } from '../../domain/executionSubtask';
import type { BusinessExecutionDeps } from './dependencies';

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
    if (!await deps.subtasks.checkpoint(claimed, info.incarnation)) return;
    incarnation = info.incarnation;
    const input = SubmitBusinessSubtaskV3Schema.parse(JSON.parse(await deps.cipher.open(claimed.sealedPayload)));
    if (input.kind !== 'command') throw new Error('command dispatcher received a different invocation kind');
    const result = BusinessExecutionReceiptSchema.parse(await deps.runner.sendCommand(claimed.runtimeTaskId ?? claimed.taskId, {
      id: newResourceId(), type: 'startBusinessCommand', executionId: claimed.view.executionId, attempt: claimed.view.attempt,
      incarnation, payloadDigest: claimed.payloadDigest, command: input.argv, cwd: input.cwd, env: input.env, timeoutSeconds: input.timeoutSeconds,
    }));
    await acceptReceipt(deps, { ...claimed, incarnation }, result);
  } catch (error) {
    const code = errorCode(error);
    // Only a pre-start capability/config rejection proves no process was admitted.
    if (!incarnation && ['unsupported_capability', 'unsupported_runner', 'invalid_configuration'].includes(code ?? '')) {
      await deps.subtasks.settle(claimed, { dispatch: 'failed', view: { ...claimed.view, state: 'failed', process: 'not-started', error: { code: code!, message: '运行环境不支持该执行' }, endedAt: deps.clock.now().toISOString() } });
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
