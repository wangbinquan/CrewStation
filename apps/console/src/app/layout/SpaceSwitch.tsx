import { useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { api } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import { useApiQuery } from '../../shared/api/useApi';
import { useT } from '../../shared/lib/useT';
import { recallWorkbenchPath, rememberWorkbenchPath } from './spaceMemory';
import styles from './TopBar.module.css';

/**
 * 顶栏的空间切换（RFC-002）。只对管理员渲染——**这是导航，不是权限边界**：
 * 权限边界在后端，每个管理路由本来就有 isAdmin 校验，藏掉入口只是不给普通用户一个必然撞墙的按钮。
 */
export function SpaceSwitch({ rememberLocation }: { readonly rememberLocation: boolean }): ReactElement | null {
  const t = useT();
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const navigate = useNavigate();
  const { pathname, href } = useLocation();
  const inAdmin = pathname.startsWith('/admin');
  // 分类、对象和筛选也属于返回位置；同路径改变 query 后仍要更新。
  useEffect(() => {
    if (rememberLocation) rememberWorkbenchPath(href);
  }, [href, rememberLocation]);
  if (me.data?.isAdmin !== true) return null;
  return (
    <button
      type="button"
      className={styles.spaceSwitch}
      onClick={() => void navigate({ href: inAdmin ? recallWorkbenchPath() : '/admin' })}
      title={inAdmin ? t('topBar.toWorkbenchHint') : t('topBar.toAdminHint')}
    >
      {inAdmin ? t('topBar.toWorkbench') : t('topBar.toAdmin')}
    </button>
  );
}
