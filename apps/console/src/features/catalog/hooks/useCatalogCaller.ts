import { useCallback } from 'react';
import { ProjectDtoSchema, ProjectPageSchema } from '@crewstation/contracts';
import type { ManifestKind } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useAdminPage } from '../../../shared/admin/useAdminRead';
import { useT } from '../../../shared/lib/useT';

/** 选择目录只读当前页；已选项目独立读取，不因翻页从调用方退回平台。 */
export function useCatalogCaller(projectId: string | undefined, q = '', cursor?: string) {
  const t = useT(), request = { q, cursor, kind: ['DigitalWorker', 'APIProxy', 'EventProducer'] as ManifestKind[], limit: 20 };
  const list = useAdminPage(queryKeys.adminProjectPage(request), async () => {
    const result = ProjectPageSchema.safeParse(await api.projects.page(request));
    if (!result.success || result.data.items.length > 20 || result.data.items.some((r) => r.role !== 'admin') ||
      new Set(result.data.items.map((r) => r.project.id)).size !== result.data.items.length) throw new Error(t('catalog.caller.invalidDirectory')); return result.data;
  });
  const selected = useAdminPage([...queryKeys.project(projectId ?? ''), 'admin-caller'], async () => {
    const result = ProjectDtoSchema.safeParse(await api.projects.get(projectId!));
    if (!result.success || result.data.id !== projectId) throw new Error(t('catalog.caller.invalidProject')); return result.data;
  }, !!projectId);
  const refresh = useCallback(async () => {
    const identity = await list.me.refetch({ cancelRefetch: false });
    if (!identity.error && identity.data?.isAdmin && identity.data.id === list.me.data?.id) await Promise.all([
      list.query.refetch({ cancelRefetch: false }), ...(projectId ? [selected.query.refetch({ cancelRefetch: false })] : []),
    ]);
  }, [list.me.refetch, list.me.data?.id, list.query.refetch, selected.query.refetch, projectId]);
  const project = projectId && selected.query.data?.id === projectId ? selected.query.data : undefined;
  return { list: list.query, selected: selected.query, project, refresh, busy: list.busy || selected.busy,
    ready: !projectId || !!project?.serviceId && !selected.query.error && !selected.query.isPending && !selected.busy };
}
