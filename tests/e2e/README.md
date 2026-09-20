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

## 在 GitHub CI 上

`.github/workflows/ci.yml` 的 `e2e` 作业会真装一套平台再跑这些用例：kind 建集群 → `bootstrap.sh`
→ 把 Traefik 的 web NodePort 钉到 30080（kind 把宿主机 80 接到它）→ `install-platform.sh` →
起无头 Chrome → `bun test tests/e2e`。快门禁 `check` 作业不受影响，仍然几分钟出结果。

`e2e` 作业设了 `CS_TEST_REQUIRE=e2e`：网关、浏览器与管理员都是作业自己装的，探测不到或登录不上在那里是**故障**，
`e2eAvailable()` 与 `openAdminSession()` 会抛错让作业变红，而不是像本机那样整套跳过（`requiredMode.test.ts` 锁的就是这一点，规则见
`docs/engineering/testing.md` §5）。项目空间用例在 CI 里仍然因为没有 GitLab 而跳过，这是登记在案的防护缺口（同文 §10）。

两个 CI 专用开关：`CS_SKIP_TASK_RUNTIME=1` 跳过要联网装两个 Agent CLI 的任务容器镜像（前台验收
用不到，它也是最容易被网络拖住的一步）；`CREWSTATION_NODE_CONTAINER` 让节点名不再钉死在
`desktop-control-plane`。

**网关必须落在 80 端口**：登录跳转地址由平台配置的用户域生成，不带端口。放在 8080 上时浏览器会被
302 到 `http://console.cs.localhost/auth/login`，撞上没人监听的 80，页内请求随即 `Failed to fetch`。

**项目空间的用例在 CI 里是跳过的**：开通链第二步 `ensureRepository` 需要 GitLab，CI 里没有，
所以全新集群里没有「已开通且有服务的数字人项目」可测。这些用例只在有真实项目的环境（比如本机）
才跑。要让 CI 也覆盖它们，得先让 CI 有一个可用的 GitLab。

## 用例怎么写

- **不写死环境里的 ID。** 用例以当前身份问平台要一个真实项目（`/v1/projects`），因此换台机器、换套数据依然成立。
- **每条断言对应一条平台能力**，不是对应一个组件。`ADMIN_PAGES` 与 `PROJECT_PAGES` 两张表就是能力清单，加一条能力就在表里加一行。
- **每一步都要求控制台无报错**（`takeErrors()`）。页面「看起来渲染了」但背后在刷错误，同样算坏。
- **权限退化要显式排除**：管理页只断言「有这块内容」是不够的，判定退化时它会变成拒绝页，所以额外断言不出现拒绝文案。
- **布局断言量真实距离**：`layoutSpacing.test.ts` 在 1280px 与 390px 测量示例框／表格／字段到操作区的间距、按钮尺寸与页面溢出。只打开页面和展开发布准备，不签发凭据、不保存配置、不发布版本；项目用例沿用上述真实项目发现与缺失时跳过规则。

## 一个坑

本机若设了 `HTTP_PROXY`，目标关着时代理会替它回一个 5xx，于是「fetch 没抛异常」会把「连不上」误读成「可用」。
可用性探测因此不看有没有抛异常，而是校验回来的东西对不对：网关要求状态码 < 500，浏览器要求 `/json/version` 真的给出
`webSocketDebuggerUrl`。自己加探测时请照这个来。
