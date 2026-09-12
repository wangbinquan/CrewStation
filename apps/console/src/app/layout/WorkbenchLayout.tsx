import type { ReactElement } from 'react';
import { AppShell } from './AppShell';
import { WorkbenchNav } from './WorkbenchNav';

/** 租户空间的布局：所有登录用户都进得来，没有守卫。 */
export function WorkbenchLayout(): ReactElement {
  return <AppShell nav={<WorkbenchNav />} />;
}
