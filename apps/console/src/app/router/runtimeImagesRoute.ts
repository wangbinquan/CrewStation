import { createRoute } from '@tanstack/react-router';
import { adminRoute } from '../../features/admin';
import { AdminRuntimeImagesPage } from '../../features/runtime-images';

export const runtimeImagesRoute = createRoute({ getParentRoute: () => adminRoute, path: 'runtime-images', component: AdminRuntimeImagesPage });
