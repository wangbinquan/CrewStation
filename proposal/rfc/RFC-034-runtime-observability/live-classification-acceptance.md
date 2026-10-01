# RFC-034 分类 Token 与人民币真实任务验收

状态：实际 API / 原 Pod 数字对账通过；真实页面复验待 Mac 解锁。生产开发采集仍 OFF，本页不关闭 CS-R02 / 03 / 04 / 13 或整个 RFC。

## 版本与专用配置

平台源码 `85ee9254a175848d65105d16327e00afbc47cc08` 的 [CI 36875167666](https://github.com/wangbinquan/CrewStation/actions/runs/36875167666) 六项 completed / success。2026-10-01T14:42:26.034Z 本机升级完成：八组件 Ready、generation=observedGeneration、storage-contract=1，迁移 applied=0。控制面与 console 的实际 OCI 来源为该提交。发布使用冻结提交构建，部署有新鲜 CAS 和数据库备份；默认 Runner 及已有执行保留。

专用档位 `rfc027-live-agent`（`01a0e236-4779-7000-99e6-6e096bd1c2bf`）保持修订 4、非默认、只由验收应用 `rfc027-live` 引用。专用镜像摘要 `sha256:744404d68becb3eba3ba234fddfbf48a8e5c2621af706b18b7721f60186030aa`，OpenCode 1.18.29，原生数字数据库位于原任务 `/work` 内；没有替换已有会话或应用实例。

人民币目录 `01a0f780-cae8-7000-9081-bedcfce7e86b` 仅用于这套明确标记的验证配置，不代表供应商账单。每百万 Token：输入 ¥2、缓存读取 ¥0.5、缓存写入 ¥3、输出 ¥8。2026-10-01T12:46:53.016Z 生效，以下任务均在生效后受理；旧修订价目与旧未定价执行保持原事实。

## 标准自测与保留的失败

原平台自动自测 `01a0f780-ca76-7000-87c1-67c7bd232102` 因虚构平台项目参与租户准入而失败，该记录保留。投影修复不修改项目存在或删除保护，规范完整门禁 4,905 pass / 143 skip / 0 fail 后发布部署，详见 [平台自测受理修复](./profile-test-admission.md)。

第一次标准人工自测 `01a0f7eb-5f6f-7000-9fea-080c548e64ed` 整体 passed，但可选业务 `systemPrompt=false`；因此带发布系统提示的业务调用实际返回 HTTP 412，符合能力守卫。原两个无模型子任务的父任务和一个成功命令父任务均正常关闭、quotaHeld=false；命令退出码在 v3 DTO 的 `result.exitCode` 内，验收脚本首次读错层级而报错，已修正，不改变产品状态。

原探测持久元数据表明第三个 Agent 正常退出 0，但文本长度 395、未匹配 33 字标记形状。依据串行探测源码推断它对应 systemPrompt；没有导出提示词或响应正文，也不能据此认定提示丢失或模型波动。独立诊断回执保留这一区别。

只进行一次新的标准人工自测 `01a0f800-fd5b-7000-abab-732c4547258b`，于 15:09:47.010Z 正常通过，systemPrompt=true。两次的修订、内容 hash 和镜像一致，旧 false 仍可读取；未手改能力标志、删除失败或绕开系统提示要求。随后业务验证在创建父任务前再次读取真实能力，确认修订 4 / events / usage / systemPrompt 后才受理。

## 实际运行结果

验证范围标记 `classification-1790867497852`，项目名称 `RFC027 execution acceptance`，项目 `01a0e230-b5b2-7000-aead-11379a2dc9a8`。

| 任务 | 原父任务 ID | 输入 | 缓存读取 | 缓存写入 | 输出 | 合计 | 人民币 | 原生步骤 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 单 Agent | `01a0f805-6505-7000-bde3-0f060757c9bc` | 5,641 | 2,240 | 0 | 394 | 8,275 | ¥0.015554 | 1 |
| 两次串行 Agent | `01a0f806-76f1-7000-915f-425131297c4e` | 276 | 15,488 | 0 | 384 | 16,148 | ¥0.011368 | 2 |
| 命令基线 | `01a0f807-fc1b-7000-8264-320d599300cd` | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | — |
| 三次模型合计 | — | 5,917 | 17,728 | 0 | 778 | 24,423 | ¥0.026922 | 3 |

输出桶只计一次原生 `output + reasoning`，reasoning 不作为第五桶再次相加。缓存写入的已知 0 来自原生步骤字段；命令不是一次有模型用量的执行，不提升 Token 完整性或伪造已知零费用。

| 任务 | 墙钟 ms | 累计执行 ms | 活动并集 ms |
| --- | ---: | ---: | ---: |
| 单 Agent | 69,771 | 30,914 | 30,914 |
| 两次串行 Agent | 98,762 | 57,409 | 57,409 |
| 命令基线 | 26,688 | 2,005 | 2,005 |

墙钟按原父任务创建至关闭计算；活动和累计按原子任务 startedAt / endedAt 逐段手算，未知区间为 0。串行验收不冒充并行验收。

## 对账方法与权限

每个原父 Pod 正常关闭前验证实际 UID、唯一 Running 实例及 `/work` 挂载的原任务 subPath，再以只读 SQLite 读取 `step-finish` 的数值字段和原 session ID。三步原生数值分别按采集 proof 的 root 映射到各尝试，未遗漏或重复。没有读新建替代容器的数据库，没有用 DTO 夹具替代真实模型调用。

同一范围下，尝试、任务、Agent、算力修订、项目、系统与趋势的四桶逐项一致；人民币以 Decimal 按冻结受理价计算并一致，三次模型均完整、observedExecutions=3。原父任务全部 closed / generation=2 / quotaHeld=false。命令在范围中保留，但不进入模型执行分母。

系统管理员费用可见；项目费用政策仍隐藏，项目接口 amount=null / complete=false，数字分类照常可见。未为了验收放开项目费用或切换身份。浏览器验证会使用同一时间 / 名称 / 状态 / 来源范围，核对真实柱上数值、分类明细、名称、泳道与返回。

## 私有证据与未完成范围

只记录证据文件名及 SHA256，原始事件和数据库数值留在本机 0600 文件，不将凭据、提示词、正文或私有部署材料入库。

| 私有回执 | SHA256 |
| --- | --- |
| `observability-cs-classification-crosscheck.json` | `8bb4bdb7a65702d8704351fbd43b703eecc4be0d91569396534988b306df8336` |
| `observability-cs-classification-live-native-evidence.json` | `a3e190f06984ca260da9249d4f4ade9f02e0237c0877b49fe316507ecf028176` |
| `observability-cs-classification-live-events.jsonl` | `e4edf7ff6273f3a70b44528a239c475f5acac1a0ac68b9230e5428df90771b48` |
| `observability-cs-system-prompt-recheck-receipt.json` | `c63181cc15f332d152caa3b79359d2ba1a2d7f0a6d3fc94212037551ce0e04a2` |
| `observability-cs-system-prompt-probe-diagnosis.json` | `50ee906e72840576e75e9d22947c4bdf102b6c8bac11f6f4096679b05877c667` |

本页完成专用配置的业务任务分类 / 人民币 / 时间 API 实采验证。真实页面验收待解锁，开发 headless / CLI 与平台自测数字归因、所有删除 / seal / 未绑定出口、AW 托管联动及其余验收矩阵继续。生产开发 producer OFF，两个 RFC 保持 In Progress。
