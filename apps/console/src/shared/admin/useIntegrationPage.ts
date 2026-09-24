import { useLocation, useSearch } from '@tanstack/react-router';
import { api } from '../api/client';
import { queryKeys } from '../api/queryKeys';
import { useApiQuery } from '../api/useApi';
import { useProjectIdentity } from '../project/useProjectIdentity';
import { isIntegrationKind } from './integrationKinds';

/** 管理空间里按项目 ID 打开、却不在项目空间里的页面：开通与资源配置（旧的 compute 地址随后跳到资源配置）。 */
const ADMIN_PROJECT_PAGE = /^\/admin\/projects\/([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/(?:provisioning|resources|compute)$/;

/**
 * 当前页面是否归「能力接入」（2026-09-24 裁定）：接入项目的项目空间、新建接入容器，以及接入项目的开通页与资源配置页。
 * 后两页的路径在 /admin/projects 下，读到项目种类才知道归谁，读到之前返回 undefined；读不到就按项目管理算。
 * 只替管理员读项目：别的身份在这些页面只会看到拒绝说明，顶栏与左栏不该为它去读项目。
 */
export function useIntegrationPage(): boolean | undefined {
  const pathname = useLocation().pathname.replace(/\/+$/, ''), scope = useSearch({ strict: false }).scope;
  const me = useApiQuery(queryKeys.me(), () => api.me.get()), admin = me.data?.platformRole === 'admin';
  const projectId = ADMIN_PROJECT_PAGE.exec(pathname)?.[1], project = useProjectIdentity(admin ? projectId : undefined);
  if (pathname.startsWith('/admin/integrations/')) return true;
  if (pathname === '/admin/projects/new') return scope === 'integration';
  if (!projectId || me.error || me.data && !admin) return false;
  if (project.data) return isIntegrationKind(project.data.kind);
  return project.error ? false : undefined;
}
