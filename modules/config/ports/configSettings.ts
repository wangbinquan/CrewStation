export interface ConfigSettings {
  /** Secret 加密密钥：base64 编码的 32 字节；来自安装配置，不落库。 */
  readonly secretKeyBase64: string;
}
