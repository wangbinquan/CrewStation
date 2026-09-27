import { createElement, type ReactElement } from 'react';
import { createRoute, useRouter, useRouterState } from '@tanstack/react-router';
import { adminRoute } from '../../features/admin';
import { AdminRuntimeImagesPage, ImageDetail, parseImageCatalogSearch } from '../../features/runtime-images';

declare module '@tanstack/react-router' { interface HistoryState { runtimeImageCatalog?: boolean } }

export const runtimeImagesRoute = createRoute({ getParentRoute: () => adminRoute, path: 'runtime-images', component: RuntimeImagesCatalog, validateSearch: parseImageCatalogSearch });

function RuntimeImagesCatalog(): ReactElement {
  const filter = runtimeImagesRoute.useSearch(), navigate = runtimeImagesRoute.useNavigate();
  return createElement(AdminRuntimeImagesPage, { filter, onManage: (imageId: string) => { void navigate({ to: '/admin/runtime-images/$imageId', params: { imageId }, search: filter, state: { runtimeImageCatalog: true } }); }, onChange: (q: string, before?: string) => { void navigate({ search: { q, before }, resetScroll: false }); } });
}

export const runtimeImageDetailRoute = createRoute({ getParentRoute: () => adminRoute, path: 'runtime-images/$imageId', component: RuntimeImageManagement, validateSearch: parseImageCatalogSearch });
function RuntimeImageManagement(): ReactElement {
  const router = useRouter(), fromCatalog = useRouterState({ select: (state) => state.location.state.runtimeImageCatalog });
  const { imageId } = runtimeImageDetailRoute.useParams(), filter = runtimeImageDetailRoute.useSearch(), navigate = runtimeImageDetailRoute.useNavigate();
  return createElement(ImageDetail, { key: imageId, imageId, projectId: undefined, editable: true, admin: true, manageable: true, standalone: true, initialTab: 'settings', onClose: () => { if (fromCatalog) { router.history.back(); return; } void navigate({ to: '/admin/runtime-images', search: filter, resetScroll: false }); } });
}
