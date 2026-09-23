import type { ApiOperationDto } from '@crewstation/contracts';
import { useRef, useState } from 'react';
import type { CatalogActions } from './useCatalogActions';

/**
 * 「申请定向开放」弹窗（2026-09-23 起由行内表单改为弹窗）：申请理由按操作各留一份草稿，关窗不丢、再打开恢复，
 * 受理成功才丢；侧栏的行按钮与放大形态的详情栏共用这一个弹窗。
 */
export function useAccessRequestDialog(actions: CatalogActions) {
  const [target, setTarget] = useState<ApiOperationDto>(), [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(new Map());
  const submitting = useRef(false);
  const edit = (operationId: string, reason: string | undefined) => setDrafts((current) => {
    const next = new Map(current);
    if (reason === undefined || reason === '') next.delete(operationId); else next.set(operationId, reason);
    return next;
  });
  return {
    target,
    reason: target ? drafts.get(target.id) ?? '' : '',
    /** 打开时清掉上一次提交的结果，失败原因只属于那一次。 */
    open: (operation: ApiOperationDto) => { if (!actions.requestAccess.isPending) actions.requestAccess.reset(); setTarget(operation); },
    close: () => setTarget(undefined),
    change: (reason: string) => { if (target) edit(target.id, reason); },
    submit: () => {
      if (!target || submitting.current) return;
      const operationId = target.id, reason = drafts.get(operationId) ?? '';
      submitting.current = true;
      actions.requestAccess.mutate({ operationId, reason: reason.length > 0 ? reason : undefined }, {
        onSuccess: () => { edit(operationId, undefined); setTarget((current) => (current?.id === operationId ? undefined : current)); },
        onSettled: () => { submitting.current = false; },
      });
    },
  };
}
export type AccessRequestDialogState = ReturnType<typeof useAccessRequestDialog>;
