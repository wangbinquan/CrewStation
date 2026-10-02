import type { UserId } from '@crewstation/contracts';
import { compatibilityEvidence, requireAvailable } from '../compatibility';
import { isPlatformError, jsonHash, newResourceId } from '@crewstation/kernel';
import type { ImageValidation } from '../../domain/records';
import type { RuntimeImageValidationContext, RuntimeImageValidationExecutor } from '../../ports/validationExecutor';
import type { RuntimeImageDeps } from '../dependencies';
import { claimValidation, updateClaimedValidation } from './leases';

/** 一个验证最多派发一次。控制器接管在途记录时只清理并报告 unknown，不重放脚本或模型调用。 */
export function runtimeImageValidationController(deps: RuntimeImageDeps, executor?: RuntimeImageValidationExecutor) {
  const reconcileValidation = async (id: string) => {
    if (!executor) return;
    let claim: ImageValidation | undefined = await claimValidation(deps, id, newResourceId());
    if (!claim) return;
    const patch = (fields: Partial<ImageValidation>) => updateClaimedValidation(deps, claim!, async (_s, current) => ({ ...current, ...(current.state === 'cancelling' && fields.state ? {} : fields), updatedAt: deps.clock.now().toISOString() }));
    try {
      const ref = await deps.uow.read.references.get(claim.versionId, 'validation', claim.id);
      if (!ref?.snapshot) throw new Error('验证快照缺失');
      let context: RuntimeImageValidationContext = { validation: claim, snapshot: ref.snapshot };
      if (claim.state === 'running' && !claim.pendingOutcome) claim = await patch({ pendingOutcome: { state: 'unknown', error: '验证进程中断，无法确认已执行步骤；请发起新的验证', checks: claim.checks } });
      if (!claim) return;
      if (claim.state === 'queued') {
        const actor = { userId: claim.createdBy as UserId, isAdmin: await deps.isAdmin(claim.createdBy as UserId) };
        await deps.authorizer.authorize(actor, claim.projectId, 'develop');
        const { version, revision } = await requireAvailable(deps, actor, claim.projectId, claim.versionId, deps.uow.read);
        const evidence = await compatibilityEvidence(deps, actor, claim.projectId, version, revision, claim.target);
        if (evidence.contractDigest !== claim.contractDigest) { claim = await patch({ state: 'running', pendingOutcome: { state: 'failed', error: '验证材料已变化，请重新验证', checks: [] } }); }
      }
      if (claim?.state === 'queued') {
        claim = await patch({ state: 'running', executionStartedAt: deps.clock.now().toISOString() });
        if (!claim || claim.state !== 'running') return;
        context = { ...context, validation: claim };
        const heartbeat = async () => {
          try { await deps.projectAdmissions?.check([claim!.projectId]); } catch { return false; }
          const next = await updateClaimedValidation(deps, claim!, async (_s, current) => ({ ...current, leaseUntil: new Date(deps.clock.now().getTime() + 60000).toISOString() }));
          return !!next && next.state === 'running' && (!next.deadline || next.deadline > deps.clock.now().toISOString());
        };
        await deps.projectAdmissions?.check([claim.projectId]);
        const outcome = await executor.run(context, heartbeat);
        const matchedImage = outcome.observedImageId === context.snapshot.digest || outcome.observedImageId?.endsWith(`@${context.snapshot.digest}`);
        const checked = outcome.state === 'passed' && ((!matchedImage && !(context.validation.target.usage === 'service' && outcome.verification === 'service-contract')) || outcome.checks.some((check) => !check.passed))
          ? { state: 'failed' as const, error: '验证结果的实际镜像身份或检查项不符合预期', checks: outcome.checks } : outcome;
        claim = await patch({ pendingOutcome: checked });
        if (!claim) return;
      }
      if (!claim) return;
      await deps.projectAdmissions?.check([claim.projectId]);
      if (!await executor.stop({ ...context, validation: claim })) return;
      await updateClaimedValidation(deps, claim, async (s, current) => {
        const { leaseOwner: _owner, leaseUntil: _until, pendingOutcome, ...rest } = current;
        const result = current.state === 'cancelling' ? { state: 'cancelled' as const } : pendingOutcome;
        if (!result) return current;
        const ref = await s.references.get(current.versionId, 'validation', current.id);
        if (ref) await s.references.remove(ref.id);
        return { ...rest, ...result, updatedAt: deps.clock.now().toISOString() };
      });
    } catch (error) {
      if (claim?.state === 'queued' && isPlatformError(error) && error.kind !== 'unavailable') await patch({ state: 'running', pendingOutcome: { state: 'failed', error: '验证准入材料或当前权限不满足要求', checks: [] } });
      // 外部操作异常可能发生在创建或启动后；持久 running 让下一轮只清理，不重执行。
      deps.logger.warn('runtime image validation reconciliation unavailable', { validationId: id });
    } finally {
      if (claim) await updateClaimedValidation(deps, claim, async (_s, current) => { const { leaseOwner: _owner, leaseUntil: _until, ...rest } = current; return rest; });
    }
  };
  const runValidation = async (id: string) => {
    if (!deps.projectAdmissions || !executor) return reconcileValidation(id);
    const validation = await deps.uow.read.validations.get(id);
    if (!validation || ['passed', 'failed', 'unknown', 'cancelled'].includes(validation.state)) return;
    return deps.projectAdmissions.run([validation.projectId], { kind: 'validation', id,
      inputDigest: jsonHash({ id, projectId: validation.projectId, versionId: validation.versionId, contractDigest: validation.contractDigest }) }, () => reconcileValidation(id));
  };
  return { runValidation, reconcileValidations: async () => {
    const pending = await deps.uow.read.validations.runnable(deps.clock.now().toISOString(), 4);
    await Promise.all(pending.map((validation) => runValidation(validation.id)));
  } };
}
