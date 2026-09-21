import { Navigate } from '@tanstack/react-router';

/** 旧书签继续定位到项目管理下的共享模板。 */
export function AdminTaskProfilesPage() {
  return <Navigate to="/admin/projects/resource-templates" search={{ kind: 'task' }} replace />;
}
