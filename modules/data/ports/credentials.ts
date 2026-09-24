/**
 * RFC-025 I28 裁定：库与运行角色由 data-control 建，口令它生成、加密存在自己的表里；data 渲染容器的连接串时经这个端口要，
 * 值不落 data 的库、不进台账。由组合根接上 data-control。
 */
export interface DataCredentials {
  credentialOf(resourceId: string): Promise<{ role: string; password: string } | undefined>;
}
