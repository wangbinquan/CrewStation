# RFC-007｜实施计划

| 任务 | 内容 | 验收 |
|---|---|---|
| T1 | dev-auth 固定角色与独立页面 | 四角色、数字人项目选择、错误态与窄屏重排 |
| T2 | 可复用开发 IdP | discovery、PKCE、JWKS、userinfo 测试 |
| T3 | 平台 HTTP 客户端与幂等播种 | Provider／用户／管理员标记全部走公开 API |
| T4 | 项目成员关系收敛与一键登录 | developer／tester／member 权限视角准确 |
| T5 | 本机 Kubernetes 清单与安装编排 | `install-platform.sh` 自动部署，可跳过 |
| T6 | 生产隔离、文档、本地 gate | 隔离测试与 `bun run check` 通过 |
| T7 | 本机 Chrome 实机验收 | 四角色连续切换、目标项目与管理空间可见性正确 |
| T8 | 提交、推送、精确 SHA CI | check 与 e2e 终态成功 |

## 实施状态

作者于 2026-09-20 直接要求完整实现并适配当前环境。T1–T7 已完成：协议与边界定向测试 8／8、部署 1／1 Ready，Chrome 四角色、旧页签令牌恢复与 `/v1/me` 实机通过；统一候选最终 `bun run check` 1614 pass／5 skip／0 fail。详见 [acceptance-audit.md](./acceptance-audit.md)。T8 等待提交、推送和精确 SHA CI。
