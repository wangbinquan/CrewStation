# 原镜像仓库底层盘点候选

`deploy/k8s/system/20-registry.yaml` 使用 Distribution 3.1.1，原仓库数据 PVC 由多个项目共享。该版本的 [linkedBlobStore.Delete](https://raw.githubusercontent.com/distribution/distribution/v3.1.1/registry/storage/linkedblobstore.go) 只清理仓库访问链接，没有删除全局 blob 文件；[原生布局](https://raw.githubusercontent.com/distribution/distribution/v3.1.1/registry/storage/paths.go) 包含全部 manifest revisions、tag current/index、layer links、上传中间文件及独立全局字节。因此只看 tags、DELETE 返回或 API 404，无法证明项目制品字节已回收。全局 GC 要求停止或封闭全仓库写入，见 [上游 GC 条件](https://distribution.github.io/distribution/about/garbage-collection/)；本候选没有执行全局 GC 或清空共享数据。

新增 `packages/filesystem-metrics/registry/` 原生只读盘点。直接读取固定 filesystem v2 布局，完整遍历所有仓库的 revision/tag/layer 链接，包括覆盖后的旧版本、没有 tag 的制品、索引和 subject；沿 manifest 图解析 config/layer 引用。项目 prefix 按完整路径边界匹配；原历史 manifest roots 与 blob digests 即使没有仓库链接仍继续按同一字节 key 盘点。共享 blob 返回所有其他仓库引用，孤立上传及原空目录仍可见；其他项目文件不会进入本项目路径集合。

原 root／卷和每条原文件／目录记录带实际设备、inode、birth epoch、逻辑大小及 allocated bytes。全树前后核对 inode、出生、mtime、ctime、size、blocks、nlink、mode；跨设备、symlink、未知布局、冲突链接、缺失引用字节、manifest 摘要不符或混淆 manifest/index 类型均拒绝完整报告。深度、条目、manifest 描述符数及单份文档读取均有明确预算，超过预算失败，不截断后标 complete。

实际存储探针增加专用 token 保护的 `/registry/inventory` POST。只读已有 allowlist root；请求 32 KiB、完整响应 8 MiB，忙时沿用原探针串行保护。文件来源错误返回 503，不回空成功。SDK 拒绝重定向、外范围／重复／被替换的原文件身份、不匹配的 request digest、空／超大／非法 UTF-8 响应，支持原取消信号。此 API 不提供文件删除或 caller 退出回执。

## 验证原件

- `/private/tmp/cs-rfc037-registry-inventory-tests-v6.log`：完整文件探针包 43 pass／0 fail，238 断言、8 文件、349ms；实际临时 filesystem、实际 HTTP handler 和实际 SDK 验证，未创建集群验证项目、模型任务或 Garage 资源。
- `/private/tmp/cs-rfc037-registry-inventory-static-v6.log`：整仓结构、lint、后端与工作台类型均通过。期间观测会话完成自身修订，先前类型错误已消失；没有改其源码，也未因移动 HEAD 重启已经开始的检查。
- `/private/tmp/cs-rfc037-registry-inventory-red-v2.log`：其他项目只有 current tag、没有 revision link 时，其层引用被遗漏的真实候选失败；修正后通过。v1 fixture 将两个 manifest 构造成相同 digest，不能验证这个反例，原件保持，不冒充红例。
- `/private/tmp/cs-rfc037-registry-inventory-patch-v1.json`：官方改动行核对包含未追踪源码，253／253、100%，无违规。
- `/private/tmp/cs-rfc037-registry-inventory-candidate-v1.json`：8 功能路径固定、组合 86 路径，当前 28 外部在制指纹独立记录，旧功能候选保持，index 空。缓存本地／origin main 同为 `bb80a01a`；该次观测提交不是本候选发布或 CI 证明。

## 未闭合范围

本候选只证明一次完整、稳定的原生文件图盘点；`layout` 明确是 filesystem v2，不冒充已核实运行中的 Registry 二进制身份。它没有证明项目所有历史 prefix 的归属、原 registry writer 封闭、原消费者退出、文件擦除、共享 BuildKit 缓存归属或生产 Native Source 已安装。原目录有外国子仓库时，父目录也不能当成可递归删除的独占目录。后续正式 adapter 必须绑定原 Pod／节点／PVC／PV 与软件实例，固定全部历史范围，并在原写入与消费闭合后逐份回收独占内容，保留共享内容及其他项目。

正式镜像／发布 physics、对象和 SCM 十一类来源、其余原执行及管理员两层确认／原专用项目不可逆全回收仍需完成。删除入口和普通 producer 继续 OFF；原验证项目、原 GitLab 与所有其他项目资源保持。Git 执行拒绝尚无策略变化，没有重试、绕过、上库或部署本候选，也没有跨会话消息。RFC 与完整目标保持进行中。

## 原实例与挂载来源接线

`modules/platform/adapters/k8s/nativeRegistry/` 将上述文件盘点绑定到实际 Registry 来源。完整稳定分页读取 Service 的 EndpointSlice 和全部选中 Pod，原 Namespace／Service／唯一就绪 Pod／新鲜 Node 必须一致；标准启动入口与运行中 imageID 必须匹配配置的不可变镜像摘要。实际 filesystem root 必须完整挂在原 PVC／PV 上，绑定 UID、local-path 供应器、物理路径和节点；子目录挂载、重叠挂载、未支持的 CSI 或非原 claim 均拒绝。盘点通过同节点、原只读挂载的实际私有探针读取，并在回读后再次核对运行 containerID、挂载、探针身份和资源版本。对原实例的 verify 不接受同名替换后的 Pod／PVC／PV／Namespace／原目录。

回归还发现调用者在来源读取期间改变数组会改变本次项目范围。原暂停用例先红，入口现在固定原查询快照；实际 HTTP 请求和返回图仍属于最初项目，不会混入后来改写的外国范围。完整来源与文件探针 **58 pass／0 fail、283 断言、9 文件**，日志 `/private/tmp/cs-rfc037-registry-source-tests-v2.log`；源码和回归精确 lint 通过。整仓静态四层在该快照修正前已通过，日志 `/private/tmp/cs-rfc037-registry-source-static-v1.log`，修正后后端类型单独补验。官方来源改动行 **96／96、100%**，原件 `/private/tmp/cs-rfc037-registry-source-patch-v1.json`。K8s API 使用受控来源，存储盘点／HTTP handler／SDK 使用实际临时原生文件；不称为真实集群验收。

该来源仍为只读候选，未接入生产启动，没有取得写入关闭、原消费者退出或实际擦除证明。共享 BuildKit 缓存、全部历史范围、SCM／Garage 及管理员不可逆全回收的剩余项不变。禁止把来源读取成功或本地用例通过当作项目删除已经上线。
