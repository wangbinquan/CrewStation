import { AcceptedArchiveFinalizationSchema } from '@crewstation/contracts';
import { conflict, isPlatformError, notFound, precondition } from '@crewstation/kernel';
import type { ArchiveBindingView, ArchiveFinalizationApi } from '../api/archiveFinalizationApi';
import type { ArchiveBindingRepository } from '../ports/archiveBindings';
import type { ArchiveTaskDirectory } from '../ports/archiveTasks';
import type { ArchivePlanRepository } from '../ports/archivePlans';
import type { ObjectReadRepository } from '../ports/objectStorage';
import type { ArchiveReceiptItem } from '@crewstation/contracts';
import { assertStorageRevision } from '../domain/objectStorage';
import type { ArchiveHelperRepository } from '../ports/archiveHelpers';

const view = (b: ArchiveBindingView): ArchiveBindingView => ({ id: b.id, revision: b.revision, taskId: b.taskId, taskGeneration: b.taskGeneration, volumeUid: b.volumeUid, state: b.state, manifestDigest: b.manifestDigest, receipt: b.receipt });
export function archiveFinalization(bindings: ArchiveBindingRepository, tasks: Pick<ArchiveTaskDirectory, 'accepted' | 'revision'>, sources?: { plans: Pick<ArchivePlanRepository, 'get'>; reads: Pick<ObjectReadRepository, 'objects'>; helpers?: Pick<ArchiveHelperRepository, 'results' | 'completed' | 'failure'> }): ArchiveFinalizationApi {
  return {
    lossReceipt: async (id, revision) => { const binding = await bindings.get(id); if (!binding) return null; assertStorageRevision(binding.revision, revision); return binding.receipt?.disposition === 'loss' ? binding.receipt : null; },
    revise: async (id) => {
      const change = await tasks.revision?.(id);
      if (!change || change.id !== id) throw notFound('已受理归档修订');
      try { return { applied: true, binding: view(await bindings.reviseAccepted(change, await tasks.accepted(change.finalizationId))) }; }
      catch (error) {
        const binding = await bindings.get(change.finalizationId);
        if (isPlatformError(error) && binding?.receipt && binding.revision === change.input.expectedRevision) return { applied: false, binding: view(binding) };
        throw error;
      }
    },
    permitDeletion: async (id, revision, permitId) => { await bindings.permitDeletion(id, revision, permitId); },
    reclaimed: async (id, permitId, proofId) => { await bindings.reclaimed(id, permitId, proofId); },
    commitArchive: async (id, revision, evidence) => {
      const binding = await bindings.get(id);
      if (!binding) throw notFound('归档绑定');
      assertStorageRevision(binding.revision, revision);
      if (binding.receipt) {
        if (binding.receipt.disposition === 'loss') return view(await bindings.confirmLossStops(id, revision, evidence));
        if (binding.stopProofDigest !== evidence.stopProofDigest || binding.completionProofDigest !== evidence.completionProofDigest) throw conflict('归档收据停止证明不可替换');
        return view(binding);
      }
      if (!evidence.completionProofDigest) throw precondition('普通归档必须具有完整执行结果证明');
      if (!sources && binding.planId) throw precondition('归档清单读取能力尚不可用');
      const plan = binding.planId ? await sources!.plans.get(binding.planId) : undefined;
      if (binding.planId && (!plan || plan.revision !== binding.planRevision || plan.digest !== binding.manifestDigest)) throw conflict('归档清单已变化');
      const files = new Map((await sources?.helpers?.results(id, revision) ?? []).map((result) => [result.path, result.item]));
      if (plan?.entries.some((entry) => entry.kind === 'file') && !await sources?.helpers?.completed(id, revision)) {
        const failure = await sources?.helpers?.failure(id, revision);
        if (failure && (!failure.retryAt || Date.parse(failure.retryAt) > Date.now())) throw precondition(archiveFailureMessage(failure), { code: failure.code });
        throw precondition('等待归档助手确认清单读取完成', { code: 'archive_helper_pending' });
      }
      const items: ArchiveReceiptItem[] = [];
      // Fixed batches bound database concurrency; the receipt transaction rechecks every object and reference.
      const entries = plan?.entries ?? [];
      for (let start = 0; start < entries.length; start += 100) {
        const batch = entries.slice(start, start + 100);
        const objects = new Map((await sources!.reads.objects(batch.flatMap((entry) => entry.kind === 'object' ? [entry.objectId] : []))).map((object) => [object.id, object]));
        items.push(...batch.map((entry): ArchiveReceiptItem => {
          if (entry.kind === 'file') {
            const item = files.get(entry.path);
            if (!item) throw precondition('等待归档助手保存工作卷文件，原工作卷继续保留', { code: 'archive_helper_pending' });
            return item;
          }
          const object = objects.get(entry.objectId);
          if (!object || object.spaceId !== binding.spaceId || object.state !== 'ready') throw precondition('所选产物尚未就绪或已不可读', { code: 'archive_object_unavailable' });
          return { state: 'saved', name: entry.name, objectId: object.id, size: object.size, sha256: object.sha256 };
        }));
      }
      return view(await bindings.receipt(id, revision, { ...evidence, completionProofDigest: evidence.completionProofDigest, receiptId: id, items, disposition: plan ? 'archived' : binding.volumeUid ? 'empty' : 'never-provisioned' }));
    },
    bind: async (id) => {
      const candidate = await tasks.accepted(id);
      if (!candidate) throw notFound('已受理终结操作');
      const { projectId, serviceId, ...input } = AcceptedArchiveFinalizationSchema.parse(candidate);
      if (input.id !== id) throw conflict('持久终结操作身份不符');
      const binding = await bindings.prepareAccepted(input, { projectId, serviceId });
      return view(await bindings.confirm(id, binding.revision));
    },
    get: async (id) => { const binding = await bindings.get(id); return binding ? view(binding) : undefined; },
    observe: bindings.observe,
  };
}

function archiveFailureMessage(failure: { code: string; path: string | null }): string {
  const messages: Record<string, string> = { archive_file_missing: '必需文件不存在，请修订归档清单', archive_file_unsafe: '归档路径不能安全读取，请修订清单', archive_file_too_large: '文件超过单对象上限，请修订清单',
    archive_file_changed: '归档文件发生变化，保留原工作卷', archive_file_size_mismatch: '文件长度与清单不一致，请修订清单', archive_upload_blocked: '文件上传被拒绝，请检查对象存储状态', archive_transfer_failed: '归档传输失败，稍后重试' };
  return `${messages[failure.code] ?? '归档执行失败'}${failure.path ? `：${failure.path}` : ''}`;
}
