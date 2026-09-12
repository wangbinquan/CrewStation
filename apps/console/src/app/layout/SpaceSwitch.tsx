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
export function SpaceSwitch(): ReactElement | null {
  const t = useT();
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const inAdmin = pathname.startsWith('/admin');
  // 记住离开租户空间前的位置：切回来时回到它，而不是一律回项目列表。
  useEffect(() => {
    rememberWorkbenchPath(pathname);
  }, [pathname]);
  if (me.data?.isAdmin !== true) return null;
  return (
    <button
      type="button"
      className={styles.spaceSwitch}
      onClick={() => void navigate({ to: inAdmin ? recallWorkbenchPath() : '/admin' })}
      title={inAdmin ? t('topBar.toWorkbenchHint') : t('topBar.toAdminHint')}
    >
      {inAdmin ? t('topBar.toWorkbench') : t('topBar.toAdmin')}
    </button>
  );
}
