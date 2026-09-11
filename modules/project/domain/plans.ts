/** 管理员定义的套餐；Manifest 只按名字引用（G24）。 */
export interface ServicePlan {
  readonly name: string;
  readonly cpu: string;
  readonly memory: string;
  readonly maxReplicas: number;
  readonly description: string;
}

export interface TaskProfile {
  readonly name: string;
  readonly cpu: string;
  readonly memory: string;
  readonly storage: string;
  readonly description: string;
}
