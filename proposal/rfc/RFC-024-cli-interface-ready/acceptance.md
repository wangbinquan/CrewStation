# RFC-024｜验收记录

> 配套：[提案](./proposal.md) · [技术设计](./design.md) · [实施计划](./plan.md)

## 1. 部署（2026-09-23，UTC）

- 源码：`git archive 652677fa`（实现提交，不含工作树里并行会话的在制品）。[CI 35855602907](https://github.com/wangbinquan/CrewStation/actions/runs/35855602907) 六项成功（含 `gate` 新增代码防护与 `e2e`）。
- 镜像：`cs-control-plane:iface-20260923`、`cs-console:iface-20260923`、任务底座 `crewstation/task-runtime:iface-20260923`
  （集群仓库摘要 `sha256:80d06ddd8fd1a588085b8b9c096c81a07dcffce9aa6b08b9bea642a6ad18b731`）。
- 顺序：11:49:41 其余六个控制面部署（cs-session 必须一起换，否则旧的会把 Runner 事件里的 `ui` 字段丢掉）→ 观察一分钟，
  0 次重启、日志无 I16 特征行 → 11:51:38 cs-api → 观察两分钟，同样为 0 → 11:54:08 console。没有迁移。
- RFC-023 观察期内的计划内滚动，作者当面批准；新 Pod 的起始时刻即上面各时间点，DB-08 按新 Pod 计。
- 默认档位 `volc-glm-5-2` 从修订 5（底座 `startup-20260923`）只换镜像另存为**修订 6**，保存即测试，结果通过。
- 12:28Z 并行会话把 cs-api、cs-controller、console 滚到 `alerts-trim-20260923`（基于 `64bd5349`，包含本 RFC 的提交），
  核对线上 console 包与 cs-api 源码都带本 RFC 的改动。

## 2. 逐项结果

| 编号 | 结果 | 证据 |
|---|---|---|
| UI-01 | 通过 | 12:16 dev-developer 在 `rfc022-verify` 开始开发后点「创建开发Agent会话」（默认档位修订 6，OpenCode 1.18.29，150m CPU）。每 500 ms 取样：+10.7 秒进程拉起、步骤条进入「CLI 初始化（等待界面）」，此后浏览器里的 xterm 可见字数一直是 0；+52.9 秒出现可见文字，+54.0 秒步骤条撤掉，撤掉那一刻终端已是完整的 OpenCode 界面（logo、输入框、模型行），状态条「你正在输入」。截图：初始化中（已用 41 秒）与撤掉后各一张，见 §3 |
| UI-02 | 通过 | 名册 `startup` 七段：排队 0.55 秒、容器 0.18 秒、等待连接 4.17 秒、准备环境 1/1 0.19 秒、Agent 启动中 5.19 秒、**CLI 初始化 43.2 秒**、已就绪；首尾相接、单调。记录 `ui = { state: 'ready', by: 'screen', readyAt: 12:17:06.755Z }`，与「CLI 初始化」段的结束时刻一致 |
| UI-03 | 用例覆盖 | 本机没有 Claude Code 档位（Claude Code 在本机停在登录）；通用终端协议由 `runtimes/task/tests/nativeSupervisor.test.ts` 的真 PTY 用例覆盖（shell 提示出现并静止后上报 `ui.ready/screen`） |
| UI-04 | 通过 | 就绪后 dev-admin（项目开发者成员）与 dev-developer 读同一 CLI，`startup` 除 `observedAt` 外逐字相同，已冻结 |
| UI-05 | 通过 | 用例见设计 §7；本机 unit 482／module 1182（7 skip）／console 800 全过 |
| UI-06 | 用例覆盖 | 旧底座档位（`rfc010-*`，`rfc008-scroll` 镜像）未授权给验收项目，授权会改动共享的管理配置，未做实机。由 `nativeTerminalProjection.test.ts`、`isolatedNativeStartup.test.ts` 的旧 Runner 用例覆盖：不报 `ui` 时「CLI 初始化」跳过、拉起即就绪，时刻与之前相同 |

收尾：验收用的 CLI 已停止，开发会话已释放；共用调试 Chrome 上没有留下页面。

## 3. 观察：OpenCode 首屏 43 秒，贴近 45 秒超时

本次 OpenCode 从进程拉起到画出界面用了 43.2 秒（RFC-022 当时的实测是约 9 秒首次输出、30 秒内画完）。这一次按 `screen` 判定，
但离 Q2 定的 45 秒超时只差 1.8 秒；再慢一点就会按超时放行，用户看到的又是一块还没画完的终端。是否把超时调长，待作者裁定。
