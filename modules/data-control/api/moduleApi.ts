/** data-control 模块对外能力；每个用例在此增加一个方法签名，实现放在 application/。 */
export interface DataControlModuleApi {
  readonly name: 'data-control';
  /**
   * RFC-025 I28：data-control 建库时生成的运行角色口令（解密后的明文）；data 渲染容器的连接串时经端口要，值不进台账。
   * 这条记录的库不是 data-control 建的（旧库）或还没存下口令时返回 undefined。
   */
  credentialOf(resourceId: string): Promise<{ role: string; password: string } | undefined>;
}
