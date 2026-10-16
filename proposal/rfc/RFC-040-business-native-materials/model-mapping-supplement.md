# RFC-040 联合接线补充：OpenCode 内部子代理模型映射

> Approved / In Progress · 2026-10-16 · 作者在当前会话明确“按推荐实现”，批准方案 A。生产实现和集中验收继续，未宣称完成。

## 已核对事实

- AW `nativeMaterial.ts` 读取每个依赖 Agent 的 RuntimeProfile；当其 model 与根 Agent 不同时明确拒绝。单机 `runtime/opencode/inlineConfig.ts` 可以给子 Agent 独立 model，因此该拒绝属于 M2 能力缺口。
- CS `nativeConfig.ts` 严格禁止业务 options 提供 model/provider/baseURL/apiKey；`nativeMaterials.ts` 当前把根模型写到所有内部子代理。保留该保护，不让 AW 上传原始模型凭据或覆盖平台 provider。
- CS `agentPlan.ts` 已把父任务不可变 Manifest、算力档位修订和 credentialStamp 固定在 attempt；`agentMaterial.ts` 只按原版本取凭据。此机制应扩展到被引用的模型档位。
- OpenCode 的内部子代理仍在同一 CLI 内，不能把不同档位的镜像、二进制或任意启动参数解释为各自启动进程。不能只拼一个 model 字符串却不带对应平台 provider 配置与凭据。

## 建议合同

业务材料的 OpenCode subagents 项新增可选 `agentProfileId`（UUIDv7）；只允许引用父任务原发布 Manifest 中已授权的 Agent profile。未填写继续继承根模型，根 Agent 不接受此字段。业务不能传 model/provider/credential，Claude 入口拒绝该新字段，本次只验证 OpenCode。

平台在首次 attempt 受理时解析根及全部引用的 compute profile，验证项目授权、协议／原生模型材料能力，冻结每个 profileId/revision/credentialStamp、运行镜像／协议兼容证明和模型元数据；fresh retry 与 resume 沿原固定材料，不再读取当前默认档位或 Secret 版本。材料 digest 保持原业务请求摘要，执行 payloadDigest 另覆盖平台编译结果，不能混为一谈。

平台负责构造显式 OpenCode provider 材料。被委派档位须能给出结构化、可冻结的 provider 配置（SDK、模型表、baseURL、认证引用与 options）；仅有一个裸内置 provider 名或任意 Hook 副作用不足以证明其可委派。不能猜测各家环境变量规则。缺少结构化材料的档位在发布能力查询／启动前说明缺失，管理员可在既有档位配置中补充对应原生 provider 材料。

Runner 将平台解析的 provider 以独立、稳定的内部别名合并到 OpenCode 配置，避免两个档位使用同一个 provider 名但网关或凭据不同而互相覆盖。每个子代理只引用自己的别名/model，allowlist 同时覆盖根及本次明确授权的子模型。仅平台生成的 Runner 字段承载这些内容，业务 API 不接受编译后字段。所有新增凭据进入既有脱敏与私有运行目录清理机制；持久 plan 只保存密文/版本引用，不存明文秘密。usage 展示保留模型档位的原身份，内部别名不暴露为业务模型名。

## 落位与校验

- contracts：严格业务 profile 引用、档位 provider 材料和 Runner 平台字段分开；合同金样记录兼容添加。
- agent-runtime：管理／解析可委派模型材料，沿原修订及 Secret 固定机制；不由 business-task 读取其内部表。
- business-task：首次受理固定依赖档位，恢复沿已存 plan；reuse 原 ComputeCatalog 公开端口，扩展版本化能力证据。
- agent-drivers：只有 OpenCode 适配器合并平台 provider 别名，业务渲染器不能越过保留键。
- AW：按现有 AW_AGENT_PROFILES 的 runtime/model 映射产生 profile 引用，缺失在派发前报具体映射；既有执行保持原材料。

用例：未授权／跨发布／跨协议／未知能力拒绝；根／子不同模型、同名 provider 不同网关、两个子代理同模型去重；Secret 轮换后重试及冷续接保持原版本；payload 摘要含固定选择；秘密不进入事件；真实 OpenCode 两个不同模型的内部委派及平台观察相符。不能以同模型子代理或单独模型 smoke 代替。

## 需要的裁定

A（推荐）：按上述“引用平台档位、平台冻结 provider 材料”补齐；保留所有现有模型权限边界，继续完整 M2。

B：本期内部子代理仅继承根模型。这会收缩 AW 已有能力，并改变 RFC-370 完整等价目标；只有作者明确接受才能采用，不能默认为完成。
