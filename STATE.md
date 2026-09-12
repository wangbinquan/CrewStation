# 当前执行状态

> 这份文件让新 session 能立刻接上进度。每完成一批工作就更新它，与提交一起推送。
> 规则见 `docs/engineering/development-rules.md` §9。

## 一句话

基线三件套（v0.3.3）的**第一轮实现已在本机 kind 集群上跑通并推上 main**；后续变更走 RFC（`proposal/rfc/`），RFC-001 与 RFC-002 已立档待批。

## 进行中的 RFC

两条都**已立档、待作者批准**，批准前不动代码（开发规则 §5.3）：

- [RFC-001](proposal/rfc/RFC-001-platform-owned-compute/proposal.md) 算力由平台统一提供。业务在 Manifest 与开发会话里不再写驱动与模型，只引用管理员定义的档位名；档位封装「用哪个驱动、哪个模型」。裁定依据：用户 2026-09-12 四选一确认。
- [RFC-002](proposal/rfc/RFC-002-admin-and-tenant-spaces/proposal.md) 管理空间与租户空间分离。顶栏切换两个空间，非管理员完全看不到管理入口；两个接入容器移出租户的项目列表。裁定依据：同上。

两者独立，可各自落地；RFC-002 为 RFC-001 的算力档位页预留 `/admin/compute` 占位路由。

## 最近一轮（2026-09-12）

**做完的事**：按 `docs/engineering/repository-structure.md` 落下全部代码——18 个模块、17 个包、9 个应用、任务容器运行时、两个接入容器、`tools/arch` 与脚手架。约 46000 行，最大源码文件 299 行（上限 600），`arch:check` 零违规。

**本机集群实跑通过的链路**（`crewstation-system`，docker-desktop kind 节点）：

- 项目开通 → 命名空间／配额／网络策略 → 建仓（最小示例模板）→ 生产数据 → 路由 → 首个标签发布到 preview 槽
- 晋级到 prod 与回滚，两个域名都在服务，切流记录带上一个发布
- 演示登录经网关注入身份，样例页读到当前用户
- 开发会话：init 容器按分支克隆源码、TaskRunner 连上 cs-session、Web 终端有真正的控制终端与作业控制、开发预览域名可访问
- 业务子任务契约：样例 `/chat` 建业务任务、子任务等容器就绪后补发、Agent 回显
- 事件链：内置 EventProducer 投递 → cs-events 去重扇出 → 样例页列出投递
- 两个 Agent CLI 装进任务镜像并以降权身份启动，报出各自的原生会话 id
- 两个平台 MCP 从开发容器内可达，会话级短期令牌鉴权，越权路由如实 403

**没做到的**：本机没有配模型凭据，两个 CLI 都停在「未登录」，**没有任何 Agent 产出过模型输出**；日志没有游标（首版读 Pod 日志尾部，Kubernetes 接口本就没有游标）；M6 的安装器、HA、规模验证未动，CLI 的 `install` / `upgrade` 对依赖发布包的阶段如实报「未实现」。

**留给作者裁定的**：`docs/engineering/implementation-open-questions.md` 的 12 条。其中 **I5 必须先裁**——实现时给 Manifest 的 `env` 项加了可选 `default`，否则模板仓库的首个标签必然发布失败、M1 门禁过不去；这是对契约的扩展，需要追认或否决。

## 下一个 session 从哪里接

1. 读 `CLAUDE.md` 与本文。
2. 要改产品行为或做非平凡重构，先按 `docs/engineering/development-rules.md` §5 立 RFC，登记进 `proposal/rfc/README.md`。
3. 动手前扫一眼 `docs/engineering/dev-gotchas.md`。
4. 本机拉起平台：`./deploy/local/bootstrap.sh`（一次性）→ `./deploy/local/install-platform.sh` → `./deploy/local/verify.sh`；工作台在 `http://console.cs.localhost/`。
