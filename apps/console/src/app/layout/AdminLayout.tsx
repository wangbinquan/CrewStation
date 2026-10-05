import { Outlet, useLocation } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { AdminGuard } from './AdminGuard';
import { AdminNav } from './AdminNav';
import { AppShell } from './AppShell';
import { AdminProjectCreationProvider } from '../admin/AdminProjectCreationPage';
import { ProjectDeletionProvider } from '../project/ProjectDeletionProvider';

/** 平台管理空间的布局：管理左栏 ＋ 守卫。守卫包住 Outlet，管理页本身不再各自判 isAdmin。 */
export function AdminLayout(): ReactElement {
  const path = useLocation().pathname;
  return (
    <AppShell nav={<AdminNav />}>
      <AdminGuard key={path}>
        <ProjectDeletionProvider><AdminProjectCreationProvider><Outlet /></AdminProjectCreationProvider></ProjectDeletionProvider>
      </AdminGuard>
    </AppShell>
  );
}
