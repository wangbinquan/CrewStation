# CrewStation 最小样例（minimal-sample）

每个新数字人项目的默认起点：一个 Bun ＋ Hono ＋ TypeScript 服务，用**零登录代码**证明平台的接入约定。管理员代建项目时，平台把它初始化进项目仓库并从首个标签构建到 preview 槽。

## 它证明了什么

| 约定 | 样例中的位置 | 怎么看到 |
|---|---|---|
| 当前用户只来自网关注入的请求头 `x-cs-user-id`／`x-cs-user-name`／`x-cs-user-email`，业务不写登录 | `src/platform/identity.ts`，首页“当前用户” | 经用户域访问时显示姓名与 ID；直接访问容器端口显示“未识别到网关身份” |
| 部署槽与环境由平台注入 `CS_SLOT`／`CS_ENVIRONMENT`；配置项按 `crewstation.yaml` 的 `spec.env` 注入（`GREETING`） | `src/platform/environment.ts`，首页“部署信息” | preview 与 prod 两槽显示不同槽名，同一份生产配置 |
| 以本服务身份调用平台 API 运行 Agent 子任务，不带任何凭据（网关按源 Pod IP 识别调用方） | `src/platform/agentClient.ts`，`POST /chat`，首页“Agent 对话” | 创建业务任务 → 提交 `chat-v1` oneshot 子任务 → 每秒轮询 → 读输出 → 关闭任务 |
| 事件订阅：cs-events 把 `EventDelivery` 信封推到 Manifest 声明的处理路径 | `src/events/gitlabHandler.ts`，`POST /events/gitlab`，首页“最近事件” | 收到 `gitlab.push` 后首页列出类型、发生时间、投递 ID 与第几次投递（内存保留最近 20 条） |
| 向目录开放自己的 API | `openapi.yaml`，`GET /api/hello` | 其他数字人经服务域调用，响应回显网关注入的 `x-cs-source-service` |
| 健康检查 | `GET /healthz` | 网关与探针使用 |

与平台的唯一契约是 `crewstation.yaml`（端口、健康路径、套餐、配置项、开放与订阅、Agent 档案、迁移策略）。

## 目录

```text
crewstation.yaml          Manifest（kind: DigitalWorker）
openapi.yaml              向目录开放的 API：GET /api/hello
src/main.ts               Hono 路由与进程入口
src/platform/identity.ts  身份请求头常量与读取
src/platform/environment.ts 平台注入的环境变量与配置项
src/platform/agentClient.ts 平台 API：业务任务与 Agent 子任务
src/events/gitlabHandler.ts 事件信封解析与内存缓冲
src/pages/home.ts         首页 HTML（所有外部值经转义）
src/main.test.ts          bun test
Dockerfile                oven/bun 镜像，bun install --frozen-lockfile --production
CONTRIBUTING.md           只指向平台的能力说明入口
```

## 本地运行（不经网关）

```bash
bun install
bun run dev                      # bun run --watch src/main.ts，监听 3000
curl localhost:3000/             # 显示“未识别到网关身份”
# 伪造网关请求头，模拟经用户域访问：
curl -H 'x-cs-user-id: usr_1' -H 'x-cs-user-name: Ada' -H 'x-cs-user-email: ada@example.com' localhost:3000/
# 模拟平台注入的部署信息与配置：
CS_SLOT=preview CS_ENVIRONMENT=production GREETING=早上好 bun run src/main.ts
# 模拟 cs-events 推送一条 gitlab.push：
curl -i -X POST localhost:3000/events/gitlab -H 'content-type: application/json' -d '{
  "deliveryId":"dlv_local_1","eventId":"evt_00000000000000000000000000000001","eventType":"gitlab.push",
  "source":{"producer":"gitlab","project":"gitlab-event-producer"},
  "occurredAt":"2026-09-11T08:00:00Z","receivedAt":"2026-09-11T08:00:01Z",
  "traceId":"0123456789abcdef0123456789abcdef","attempt":1,"payload":{"ref":"refs/heads/main"}}'
# 模拟另一个数字人经服务域调用开放 API：
curl -H 'x-cs-source-service: issue-bot/issue-bot' localhost:3000/api/hello
bun test
```

本地没有 `CS_PLATFORM_API_URL`，首页的 Agent 对话会禁用并说明原因；在开发会话或部署槽内由平台注入后即可用。

## 用 Docker 运行

```bash
docker build -t minimal-sample:dev .
docker run --rm -p 13000:3000 -e CS_SLOT=preview -e CS_ENVIRONMENT=production minimal-sample:dev
curl -H 'x-cs-user-id: usr_1' -H 'x-cs-user-name: Ada' localhost:13000/
```

## 在平台上

- **开发会话**：TaskRunner 用 `spec.development.command` 自动启动预览；平台注入 `CS_*` 与开发取值组的配置。
- **发布**：工作台发布按钮、`crewstation` CLI 或操作 MCP。只有平台创建的 `v<major>.<minor>.<patch>` 标签触发构建与发布，手工打的标签不会；构建结果先到待命槽（preview），负责人切流后上线，回退即切回。`package.json` 的 `version` 不参与版本管理。
- **配置**：`GREETING` 的开发值与生产值在工作台配置页维护，生产值由项目负责人维护；改动进入下一个 Release。

## 已知边界

- 事件只存内存，`replicas: 1`；多副本时各 Pod 各自一份，真实业务应落库并按 `deliveryId` 幂等处理。
- 本模板只读网关注入的明文身份头，不验签 `x-cs-identity-token`／`x-cs-source-token`；需要时按能力说明 MCP 中的约定接入。
- 平台能力的权威说明见 `CONTRIBUTING.md` 指向的入口，本文不复述。
