# 修改接入容器

这是可独立建仓的项目，禁止 import CrewStation 工作区或相邻模板。生产方名、入口、配置名在源码和 crewstation.yaml 保持一致。修改事件矩阵时同时更新 Manifest、README 和 protocol.test.ts；未知动作不可拼出未登记的类型。

签名只使用原始请求字节；不得先 parse/stringify，不记录 secret、签名或 payload。保留 delivery ID 去重和平台回执边界。不要把 GitHub API token、用户鉴权或消费者业务规则引入此容器。

运行 `bun install --frozen-lockfile && bun test`。平台仓库另验证模板物化、真实 PostgreSQL 分发和隔离集群协议链路。验收必须区分人工签名注入与真实 GitHub 回调。
