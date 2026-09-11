/** 后台工作器与事件订阅共用的生命周期形状；进程按角色启动一组。 */
export interface Lifecycle {
  start(): void;
  stop(): Promise<void>;
}
