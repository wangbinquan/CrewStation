/** 安装配置决定服务域后缀；裁剪后的 OpenAPI servers 指向 `api.<serviceDomain>`（contracts HOST_PATTERNS.platformApi）。 */
export interface HostNaming {
  platformApiHost(): string;
}
