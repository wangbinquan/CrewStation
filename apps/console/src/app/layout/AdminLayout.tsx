import { Outlet } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { AdminGuard } from './AdminGuard';
import { AdminNav } from './AdminNav';
import { AppShell } from './AppShell';

/** 平台管理空间的布局：管理左栏 ＋ 守卫。守卫包住 Outlet，管理页本身不再各自判 isAdmin。 */
export function AdminLayout(): ReactElement {
  return (
    <AppShell nav={<AdminNav />}>
      <AdminGuard>
        <Outlet />
      </AdminGuard>
    </AppShell>
  );
}
