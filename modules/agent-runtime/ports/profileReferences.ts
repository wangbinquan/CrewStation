/**
 * 由 platform 用 release 回填（P8）：各服务 preview／prod 两槽当前部署的版本里，Manifest 按名称引用了该档位的项目。
 * 经 `default` 间接引用的不计。
 */
export interface ProfileReferences {
  listReferencingProjects(profile: string): Promise<string[]>;
}
