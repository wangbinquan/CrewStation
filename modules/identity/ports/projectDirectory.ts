import type { ProjectId } from '@crewstation/contracts';

/**
 * 用户域主机只带项目 slug，而身份转发按项目 ID 配置，所以需要这一次换算。
 * 缺省实现返回 undefined，此时所有项目一律按全局默认转发——查不到项目不该放宽任何东西。
 */
export interface ProjectDirectory {
  idBySlug(slug: string): Promise<ProjectId | undefined>;
}
