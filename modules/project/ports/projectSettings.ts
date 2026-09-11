export interface ProjectSettings {
  /** 管理员未指定时的并发任务配额；来自安装配置。 */
  readonly defaultMaxConcurrentTasks: number;
  readonly defaultServicePlan: string;
}
