/** 序列化后的密钥环（含私钥）只经此端口进出；实现方不得记录或回显其内容。 */
export interface KeyStore {
  load(): Promise<string | undefined>;
  /** 首次启动写入；多副本竞争时已有记录返回 false 且不覆盖。 */
  create(serialized: string): Promise<boolean>;
  /** 轮换后整体替换。 */
  replace(serialized: string): Promise<void>;
}
