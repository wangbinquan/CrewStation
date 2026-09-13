import { ResourceCatalogSection } from './plans/ResourceCatalogSection';

/** 服务套餐目录：Manifest 按名字引用，管理员在这里新增或覆盖。 */
export function ServicePlansSection() { return <ResourceCatalogSection kind="service" />; }
