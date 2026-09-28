import { createRoute } from '@tanstack/react-router';
import { adminRoute } from '../../features/admin';
import { ObjectStoragePage, ProjectObjectStoragePage } from '../../features/object-storage';
import { projectRoute } from './projectRoute';

export const objectStorageRoute = createRoute({ getParentRoute: () => adminRoute, path: 'object-storage', component: ObjectStoragePage });
export const projectObjectStorageRoute = createRoute({ getParentRoute: () => projectRoute, path: 'object-storage', component: ProjectObjectStoragePage });
