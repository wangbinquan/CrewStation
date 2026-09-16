/** 由 project 经组合根提供：引用某运行环境的算力档位名。 */
export interface ProfileReferences {
  listReferencing(configId: string): Promise<string[]>;
}
