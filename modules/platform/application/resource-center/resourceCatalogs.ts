import type { ResourceCatalogPorts } from '../../ports/resourceCatalogs';
import { projectResourceCatalogs } from './projectCatalog';
import { executionResourceCatalogs } from './executionCatalog';
import { dataResourceCatalogs } from './dataCatalog';
import { integrationResourceCatalogs } from './integrationCatalog';

export function resourceCatalogs(ports: ResourceCatalogPorts) {
  return [...projectResourceCatalogs(ports), ...executionResourceCatalogs(ports), ...dataResourceCatalogs(ports), ...integrationResourceCatalogs(ports)];
}
