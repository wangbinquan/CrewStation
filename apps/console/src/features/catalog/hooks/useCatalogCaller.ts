import { ProjectDtoSchema, ProjectPageSchema } from '@crewstation/contracts';
import type { ManifestKind } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useAdminPage } from '../../../shared/admin/useAdminRead';
import { useT } from '../../../shared/lib/useT';

/** 选择目录只读当前页；已选项目独立读取，不因翻页从调用方退回平台。 */
export function useCatalogCaller(projectId: string | undefined, q = '', cursor?: string) {
  const t = useT(), request = { q, cursor, kind: ['DigitalWorker', 'APIProxy', 'EventProducer'] as ManifestKind[], limit: 20 };
  // 目录与已选项目各自每 30 秒先核对身份再静默重读，不提供「重新读取项目目录」（2026-09-23 裁定）。
  const list = useAdminPage(queryKeys.adminProjectPage(request), async () => {
    const result = ProjectPageSchema.safeParse(await api.projects.page(request));
    if (!result.success || result.data.items.length > 20 || result.data.items.some((r) => r.role !== 'admin') ||
      new Set(result.data.items.map((r) => r.project.id)).size !== result.data.items.length) throw new Error(t('catalog.caller.invalidDirectory')); return result.data;
  }, true, true);
  const selected = useAdminPage([...queryKeys.project(projectId ?? ''), 'admin-caller'], async () => {
    const result = ProjectDtoSchema.safeParse(await api.projects.get(projectId!));
    if (!result.success || result.data.id !== projectId) throw new Error(t('catalog.caller.invalidProject')); return result.data;
  }, !!projectId, true);
  const project = projectId && selected.query.data?.id === projectId ? selected.query.data : undefined;
  // 例行重读不影响 ready：否则下方的接口列表每 30 秒被卸载重建一次。
  return { list: list.query, selected: selected.query, project,
    ready: !projectId || !!project?.serviceId && !selected.query.error && !selected.loading };
}
