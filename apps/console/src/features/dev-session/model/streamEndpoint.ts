/**
 * `api.stream.taskStreamUrl` 在同源部署下返回的是相对路径（baseUrl 为空），
 * 而浏览器的 WebSocket 构造函数只接受绝对地址，所以这里按页面地址补全并把 http(s) 换成 ws(s)。
 * 页面地址作为参数传入，便于单测。
 */
export function resolveStreamEndpoint(url: string, pageHref: string): string {
  if (/^wss?:/i.test(url)) return url;
  // 相对路径先按页面地址补成 http(s) 绝对地址，再整体换协议；http→ws、https→wss 一次替换即可。
  return new URL(url, pageHref).toString().replace(/^http/i, 'ws');
}
