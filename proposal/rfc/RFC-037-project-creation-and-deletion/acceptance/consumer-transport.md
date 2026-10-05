# 原文件消费者的鉴权读取接线

`filesystem-metrics` 的已有全线程读取器现在接入固定 `/consumers` HTTP 路由和公开客户端，复用原专用 bearer、常量时间验证、互斥及请求期限。请求只能提交设备／inode 和原来源，不能指定 proc 根、进程或任意文件；捕获实际 boot ID／PID namespace，后续观察必须绑定原来源。全部身份按十进制 uint64 字符串传递，不经 JavaScript 浮点数。每批最多256个身份，32KiB流式请求上限覆盖最大全宽身份，客户端8MiB响应上限超限直接拒绝、不截断。

两项真实竞态先红后绿：FD枚举结束至maps读取期间新打开原文件，旧读取器误报完整零引用；最后boot ID复核期间取消，旧读取器仍返回成功。修复为每线程复核前后原文件引用及原start tick，变化返回明确process-changed，并在最终来源读取后核对取消。读取错误、来源替换或取消不能转为零占用完成；没有读取业务内容、参数、环境或进程名称。

候选27项／0失败、177断言。预加载实际DOM后暴露5项失败，进一步红例确认Happy DOM会去掉原Request请求头，而且其取消信号不能供Bun文件I/O使用。只在测试注册器保留原生Response／Request／Headers／AbortController／AbortSignal，DOM仍由原注册器建立，未降低断言或改变生产读取条件。预加载DOM的候选与原生I/O回归29／0、182断言，完整工作台1142／0、7967断言、174文件；真实PG、两副本HTTP／WS和原观测删除组合34／0、384断言、13文件通过。整仓静态四层通过，最后两测试文件精确lint通过。以上是实际定向与工作台检查，不称新增候选全仓CI通过。

私有原件为 `/private/tmp/cs-rfc037-consumer-{http-red-v1,churn-red-v1,cancel-red-v1,batch-red-v1,dom-metadata-red-v1}.log`、`consumer-source-{tests-v4,dom-check-v1,dom-check-v2,static-v1}.log`、`consumer-console-check-v1.log`、`consumer-original-http-check-v1.log`；初版真实TCP测试的预先取消传输卡住及类型诊断同样保留。修复是实际传输在发送前检查取消、准确声明可注入fetch函数以及夹具字面量类型，没有重试或测试跳过。

## 既有Linux容器内的实际元数据读取

在当时唯一就绪的既有API Pod `7cc2a222-32e1-44c0-a83d-41aa7cda84f8` 内，经stdin运行同一候选原语。仅打开原镜像已有的非秘密源码文件只读句柄；设备240／inode6160361在原PID108、start tick114718144及其线程中出现6条实际描述符引用。finally关闭自己的句柄后，同一boot ID／PID namespace的完整读取为0引用。PodUID与原containerID前后相同，原GitLab容器没有改变，未新增／替换模型任务、项目或验证容器，未安装运行时、修改原文件或切换身份。

首版data:模块导入在执行前失败，v1原件保持；v2直接在stdin内执行同一编译源后通过。回执为 `/private/tmp/cs-rfc037-consumer-linux-check-v1.json` 和 `...-v2.json`，前后Pod清单及原GitLab身份分别存同前缀 `api-pod-before/after-v1.json`、`original-gitlab-v1.jsonl`。源摘要为 `cabcff99a00b607f3c0b153d427629755833d638cc293f3c163b87ea04f605be`。

该实机核对仅证明此既有API可见PID namespace的候选消费者读取能力。它没有覆盖原GitLab全部命名空间／挂载根，没有关闭原项目生产者，也没有证明任何项目物理回收。`completeGitLabSource=false`、`producersClosed=false`、`physicalReclamationProven=false`。候选通过stdin执行不等于发布部署；完整22owner、SCM十一类和镜像／发布物理来源、旧键兼容、最终管理员确认及原项目全回收继续，入口和producer继续OFF。

## 发布执行限制

用户明确要求最快上库上线，已有提交／部署授权持续有效。自动审批两次拒绝必要`git fetch origin main`：第一次称评审环境禁止联网及非只读操作，单独提供用户原话、AGENTS同步规则和仅更新远端跟踪引用的低风险证据后，第二次仍称禁止网络／Git引用写入且用户授权不能覆盖执行限制。没有换工具、间接执行或绕过拒绝；已向用户请求解除执行限制。缓存HEAD／origin为8db68361，但无法刷新后不能把它称为当前远端核对。共享索引仍空，新增候选未提交／推送／部署。

上一批c58a3a79的实际六项CI及八组件上线证据继续有效，见[上一批发布](fast-release.md)。它不替代本候选的精确CI，也不证明永久删除可用。

固定15路径候选后，最后 `bun run check ./packages/filesystem-metrics ./apps/console/src/tests/domSetup.test.ts` 四层整仓静态及29项回归终态通过。完整console和34项真实PG/HTTP结果按上文复用，未重复整仓所有测试；正式改动行判定93／93、100%，无违规。首尾源码与28项外会话在制文件全部指纹保持，索引仍空。最后回执 `/private/tmp/cs-rfc037-consumer-source-final-check-v1.json`；只补此文档，不使已通过的生产候选失效。
