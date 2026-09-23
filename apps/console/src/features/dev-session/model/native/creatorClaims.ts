/**
 * 本窗口点「＋ 创建开发Agent会话」创建的 CLI，按受理请求号记住（RFC-022 D1、B6）：只在这个窗口、只一次自动取得输入控制，
 * 好让 CLI 第一次查询终端时就有窗口回答、一拉起就显示界面。只存在内存里，刷新页面即清空；其他窗口与其他成员不会自动取得。
 */
const created = new Set<string>();

export const creatorClaims = {
  remember(clientRequestId: string): void { created.add(clientRequestId); },
  has(clientRequestId: string): boolean { return created.has(clientRequestId); },
  /** 进程拉起后取得成功一次即作废；之后按既有规则（焦点在终端才保持）。 */
  consume(clientRequestId: string): void { created.delete(clientRequestId); },
};
