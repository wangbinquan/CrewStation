import { createElement, type ReactElement } from 'react';
import { createRoute } from '@tanstack/react-router';
import { adminRoute } from '../../features/admin';
import { AdminRuntimeImagesPage, parseImageCatalogSearch } from '../../features/runtime-images';

export const runtimeImagesRoute = createRoute({ getParentRoute: () => adminRoute, path: 'runtime-images', component: RuntimeImagesCatalog, validateSearch: parseImageCatalogSearch });

function RuntimeImagesCatalog(): ReactElement {
  const filter = runtimeImagesRoute.useSearch(), navigate = runtimeImagesRoute.useNavigate();
  return createElement(AdminRuntimeImagesPage, { filter, onChange: (q: string, before?: string) => { void navigate({ search: { q, before }, resetScroll: false }); } });
}
