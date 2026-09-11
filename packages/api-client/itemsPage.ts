/** 列表响应的原样形状（contracts `pageOf`）：`{ items, nextCursor? }`；客户端不拆包，CLI 与工作台自行取 items。 */
export interface ItemsPage<T> {
  readonly items: T[];
  readonly nextCursor?: string;
}
