/** 安装配置决定域名后缀；模块只知道模式（contracts HOST_PATTERNS）。 */
export interface HostNaming {
  prodHost(projectSlug: string): string;
  previewHost(projectSlug: string): string;
  serviceHost(serviceName: string): string;
}
