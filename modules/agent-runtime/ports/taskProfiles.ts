/** 由 platform 用 project 回填：档位引用的资源套餐必须存在。 */
export interface TaskProfileDirectory {
  exists(name: string): Promise<boolean>;
}
