import { Outlet } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import styles from './AppShell.module.css';
import { SideNav } from './SideNav';
import { TopBar } from './TopBar';

/** 工作台外壳：左侧导航、顶栏、内容区。 */
export function AppShell(): ReactElement {
  return (
    <div className={styles.shell}>
      <SideNav />
      <TopBar />
      <main className={styles.main}>
        <div className={styles.content}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
