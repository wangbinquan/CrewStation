/** 管理员定义的资源规格；引用使用稳定 ID，名称可修改。 */
export interface ServicePlan {
  readonly id: string;
  readonly name: string;
  readonly cpu: string;
  readonly memory: string;
  readonly maxReplicas: number;
  readonly description: string;
}

export interface TaskProfile {
  readonly id: string;
  readonly name: string;
  readonly cpu: string;
  readonly memory: string;
  readonly storage: string;
  readonly description: string;
}
