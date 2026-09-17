# 平台能力的前台实机验收

`apps/console/src/tests` 里的渲染用例把 `fetch` 打了桩，证明的是「组件拿到这份数据会长这样」。
这里不打桩：真网关、真登录、真后端，逐条确认平台能力在**当前部署**的前台确实可用。
两者是互补的——后端换了字段、路由或权限判定，渲染用例可能照绿，这里会红。

## 怎么跑

需要两样东西，缺一整套自动跳过（`bun test` 在没有集群的机器上照常绿）：

1. 本机集群已装好，网关能应答 `http://console.cs.localhost`（见 `deploy/local/install-platform.sh`）。
2. 一个开着调试端口的 Chrome。**起浏览器这一步就是显式的「我要跑实机」**，所以没有另设开关：

```bash
'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  --headless=new --remote-debugging-port=9333 \
  --user-data-dir=/tmp/cs-e2e-chrome --no-first-run --no-default-browser-check \
  about:blank &

bun test tests/e2e            # 只跑实机验收
bun run check                 # 完整门禁，实机验收包含在内
```

换环境用 `CS_E2E_CONSOLE`（网关地址）和 `CS_E2E_CDP_PORT`（调试端口）覆盖。

## 用例怎么写

- **不写死环境里的 ID。** 用例以当前身份问平台要一个真实项目（`/v1/projects`），因此换台机器、换套数据依然成立。
- **每条断言对应一条平台能力**，不是对应一个组件。`ADMIN_PAGES` 与 `PROJECT_PAGES` 两张表就是能力清单，加一条能力就在表里加一行。
- **每一步都要求控制台无报错**（`takeErrors()`）。页面「看起来渲染了」但背后在刷错误，同样算坏。
- **权限退化要显式排除**：管理页只断言「有这块内容」是不够的，判定退化时它会变成拒绝页，所以额外断言不出现拒绝文案。

## 一个坑

本机若设了 `HTTP_PROXY`，目标关着时代理会替它回一个 5xx，于是「fetch 没抛异常」会把「连不上」误读成「可用」。
可用性探测因此不看有没有抛异常，而是校验回来的东西对不对：网关要求状态码 < 500，浏览器要求 `/json/version` 真的给出
`webSocketDebuggerUrl`。自己加探测时请照这个来。
