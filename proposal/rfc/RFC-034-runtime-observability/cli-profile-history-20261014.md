# 原 CLI 空档位快照的观测兼容

eedec5fb 的九项 CI 全部通过后，八组件已正常本机部署，287 迁移包含原 261 记录且校验和不变。全部旧 usage/evidence/change/price/valuation/native capture 行保持。正式页验收发现 CLI 观测读取器把原表允许为空的 profile 当作错误，原库 81 条接受记录中 7 条旧记录没有该冻结快照，execution 和 agent 原身份均一致。

读取器保留原 execution/agent 校验；有冻结 profile 时继续严格核对它与原 record 的 compute/revision。合法旧空 profile 使用原 record.compute 的已记算力标识，修订保持原 record.profileRevision 或 null，不查询当前档位猜测旧修订，不补零或伪造人民币费用。原 nullable persistence 与 RuntimeAttemptFact 合同不变，无需迁移或改原记录。

补真实独立 PostgreSQL 名册用例：211 个旧 CLI 执行全部按原 EOF 可达，保留原算力名/ID与未知修订；正常冻结修订7保持，原 record 改成8仍报冲突；profile为空也不能放过真实 execution 身份不一致。生产与全部用例先完成，再执行集中 SOURCE、相关检查及一次改变候选的完整 check，精确新 SHA CI 全绿后更新本机部署。旧 CI、失败、部署与事实核对均保留，定向绿不等于整个 RFC 完成。

新增真实用例还暴露原 CLI seek SQL 的 OR 缺少外括号，可让下一页绕过 task/time 条件，导致单执行明细读取其他执行。现将整个 seek 比较保留为同一个 AND 条件，原 task/time/EOF 顺序不变；用例覆盖一个选定执行的单执行读取，以及211条同刻记录的完整分页，二者共同覆盖该缺陷。首次静态通过、模块1通过2失败的日志保留，随后复验改变后的候选。

本候选一次原始完整 `bun run check` 已退出0：结构、lint、后端与前端类型及整库测试通过，6766 pass／177 原条件 skip／0 fail，473594 断言／1396 文件；5547 份实际输入前后完全相同，三份候选在检查中保持原指纹。独立 SOURCE R73 为 VALID／PASS0／0 findings，旧失败保留。此处只补准确的验证结果与单执行用例范围，生产和测试文件仍与检视及完整检查候选逐字相同。新提交的远端 CI 全绿与本机部署分别继续验收。
