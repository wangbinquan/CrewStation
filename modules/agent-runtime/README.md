# agent-runtime（L3）

算力档位的唯一宿主（RFC-006、ADR-0005）：一个档位就是一份完整执行配置——协议、平台仓库里的镜像（按摘要固定）、二进制与参数、启动前步骤、变量与凭据、模型、资源套餐。

- 执行内容只追加为修订；说明、启用与默认不进修订。保存即生效，每次产生新修订自动排一次测试，测试通过前租户不可选。
- 测试在平台命名空间按档位镜像起 Pod，由 `ProfileTestExecutor` 端口注入（platform 用 task-runtime 实现），本模块不 import L4。
- 资源套餐目录（project）与已上线版本的档位引用（release）同样经端口由 platform 回填；本模块不 import 其他模块。
- 密钥只以 SecretBox 密文落库；GET 从不返回原值，派发材料只经受控 Runner 命令通道发给目标任务。
- `default` 是保留名，每次解析到管理员设为默认的档位；通用终端协议的档位只能用于「＋ CLI」。
- 镜像页与推送凭据（C18）：`GET /v1/admin/runtime-images` 给出底座引用与摘要、推送地址与示例 Dockerfile；`POST /v1/admin/runtime-images/credentials` 签发带到期时间与仓库前缀的签名口令（只在该响应里出现一次）。网关对仓库主机的每个请求经 `/forward-auth/registry`（挂在 cs-auth）裁定：只放行 `/v2/` 探测、`runtime/` 前缀内的推拉与底座的只读拉取。

模板与规则见 `docs/engineering/repository-structure.md` §3。
