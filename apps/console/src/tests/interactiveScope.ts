/**
 * 用例里「可以点的范围」：开着模态弹窗时是最上层（最后打开）的那一个，否则是整个渲染区。
 * 浏览器里模态弹窗背后的页面是 inert 的，点不到；happy-dom 不管这些，所以由点击助手自己收窄，
 * 页面上的触发按钮与弹窗里的同名按钮（「取消」「进入维护」）也就不会点错。
 */
export function interactiveScope(host: ParentNode): ParentNode {
  return [...host.querySelectorAll('dialog[open]')].at(-1) ?? host;
}
