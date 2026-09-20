import { ResourceCatalogSection } from './plans/ResourceCatalogSection';

/** 服务套餐目录：Manifest 按 ID 引用，管理员在这里创建、修改与重命名。 */
export function ServicePlansSection() { return <ResourceCatalogSection kind="service" />; }
