/** 本地 git 操作；实现负责把地址里的凭据拆出来走环境变量，并从错误消息里抹掉。 */
export interface GitRunner {
  /** 在 `workdir` 初始化仓库、提交全部文件并推送到 `branch`。 */
  initAndPush(input: { workdir: string; remoteUrlWithCredential: string; branch: string; message: string }): Promise<{ commitSha: string }>;
  pushBranch(input: { workdir: string; remoteUrlWithCredential: string; branch: string }): Promise<{ commitSha: string }>;
  headSha(workdir: string, branch: string): Promise<string>;
}
