# 原存储来源、删除入口和本批发布验收

创建弹窗已部署，标识用途、最终域名和模板用途已交付。本批继续完整项目永久删除；管理员入口有两次确认，只有实际后端安装删除控制器才可使用。完整回收仍在实施，不宣布 RFC 完成。

2026-10-05 现有管理员浏览器再次核对已部署创建弹窗：目录 URL 保持，域名标识 `rfc037-domain-preview` 展示实际 `rfc037-domain-preview.cs.localhost` 与 `preview.rfc037-domain-preview.cs.localhost`，模板作用清楚。1280×720 弹窗 880×688、390×844 弹窗 358×812，均距视口 16px；窄屏横向溢出 0，正文 1210px 在 694px 内部滚动。Esc 关闭后焦点回「新建数字人」，没有提交创建或增加资源。回执 `/private/tmp/cs-rfc037-creation-browser-recheck-v1.json`。这是当前已部署创建功能复核，不代替本批删除上线。

## 删除入口

管理员项目目录和项目生命周期复用同一个删除工作流及统一弹窗。实际管理员身份与未缓存 capability 都通过后才显示入口；普通成员不调用管理员 capability，读取失败、权限失效或后端关闭均不显示入口。能力来自正式控制器是否存在；控制器安装仍要求完整 22 方 owner。默认 Root 返回 unavailable。只读 capability 始终存在，删除操作路由、工作器和恢复扫描仍只在完整装配后注册；真实 PG 的闭门回归 6 pass、45 断言，原 POST 仍为 404。

第二次确认必须准确输入 `delete`。Esc／取消只关闭最上层，返回原触发按钮，并保留目录筛选、分页和滚动。已归档项目仍允许管理员永久删除；原归档功能保持。操作已受理后继续显示同一个进度回执，丢失响应与重放沿原请求身份处理。

定向验证：界面／会话／客户端／目录及 capability 路由 46 pass、378 断言；生命周期入口 2 pass、10 断言；正式 Root 的默认关闭、22 方安装和权限 4 pass、34 断言。日志分别为 `/private/tmp/cs-rfc037-deletion-entry-tests-v1.log`、`/private/tmp/cs-rfc037-deletion-lifecycle-tests-v1.log`、`/private/tmp/cs-rfc037-deletion-entry-root-v1.log`。

## Garage 与原文件消费者

独立来源核对原 Service／EndpointSlice／Pod／容器／镜像／节点／PVC／PV、Garage 2.4.1 原配置和全部 SQLite 元数据到 EOF。对象／版本／块引用／插入队列及普通、压缩、损坏和临时块均计入；外项目引用按完整图保留。原材料在既有不可变 jsonb 中留存，文件身份不因逻辑行消失而丢失。

实际对象 DELETE／分段上传 abort 后，仍须等待原 GC 延迟，并在全局实际 PG 准入下删除无外引用的原独占块；最后重新盘点元数据、队列、原文件及节点全进程 FD。HTTP ACK 和逻辑行零不代替字节回收。新 hostPID 只读探针核实节点全部消费者，旧进程命名空间的局部盘点不计作停止证明。生产探针升级与全删除安装仍待本批部署。

对象请求的实际共享准入和独立持久回调覆盖驱动连接提前失败；原回调未退出时保持阻塞。未入 Pod 的旧执行只有真实 never-admitted 记录才能作为无进程证明，已入 Pod 的旧执行继续需要原 UID 停止回执。

定向真实 PostgreSQL Garage／对象请求／项目对象内容 21 pass、239 断言，见 `/private/tmp/cs-rfc037-garage-native-final-v1.log`。SDK／Kubernetes 来源及完整临时文件测试的受控来源不计作原项目实删验收。

## Registry 原生清理与写入准入

固定原卷、原目录出生、完整项目 prefix 和原清单；对所有其他 repository 的完整 manifest 后代引用与平台目录 pin 重新核对。实际删除用已核实原目录的相对描述符 unlink／rmdir，不接受客户端路径／脚本，也不做全局 GC。原卷替换、硬链接、符号链接、晚到文件或外部引用变化都拒绝。

运行镜像和发布工厂把原工作来源与 Registry 原材料组合保存在既有 jsonb；重建真实工厂后从同一个 JSON 原材料重放。正式许可绑定项目／operation／generation／阶段及全部原对象。回收 ACK 后，仍用独立节点文件来源重新证明原文件及消费者归零。当前测试中的工作／缓存来源受控，不能计作正式构建缓存工厂已安装。

本批新增实际全局 `storage.registry-admission`：镜像目录写入、平台构建 pin 和项目／发布原回调都持有同一个真实 PG 共享锁，迁移触发器拒绝伪造 PID 或脱离锁的直接写入。私有原生服务持久 SQLite WAL／FULL journal 在实际独占原回调内出生，只在原回调 finally 退出；连接提前失败和服务重启不擦掉活动记录。普通写入在真正取得共享锁后先检查这个原 journal。独占权限基元额外通过独立连接核对原 PG PID／backend birth／事务／锁；替换连接不能冒用它。

正式运行镜像 owner 的材料会包装原来源摘要；衔接回归发现工厂提前包装导致正式许可无法通过，现改为只在正式 owner 包装一次，并以实际 owner.inspect 输出生成许可验证。原未包装许可仍拒绝。实际 Linux 原控制器中独立临时目录的 Registry 工厂／HTTP／unlink／重建重放和正式许可 9 pass、60 断言，Pod UID／容器保持。旧载体在并行部署中正常替换，旧回执保留；新载体只用于自己的临时文件测试。原 Registry 和专用项目未改变。原 SDK／host 及共享锁真实 PG 定向测试通过；运行镜像和发布完整 44 文件 201 pass、1 环境 skip、0 fail、1520 断言，见 `/private/tmp/cs-rfc037-registry-old-fixtures-v1.log`。两个旧平台引用用例改为通过真实 UOW 写目录，不放宽原行为断言。

## BuildKit 与原构建 Pod

只读解码真实 bbolt 双 meta 校验、原 cache／result／snapshot 图和 EOF，保留 uint64、纳秒出生及 immutable／mutable／snapshot 关联。共享缓存归属同时核对完整项目层、所有外部原结果闭包、原输入时窗和独立平台模板文件；重用次数、普通文件名和旧活跃记录不证明共享。不能归属的输入保持 blocker。原 snapshot 物理 storage ID 与 lease key 分别留存。

原实例 `buildkitd-7894c47f9f-d8j7m`／UID `71d63535-b575-47ae-82bd-0608f8a38c5b`／worker `s4agj5nk6vy5bxmlc1gdws62k` 只读盘点：78 cache、139 result、245 link、74 snapshot，实际文件稳定。专用项目原产物 snapshot storage ID 为 134，不能用 lease 196 代替。全部 50 条原历史已用 native history.db 与 Control EOF 对账，活动数为 0；35 份独立 manifest 后代图覆盖所有外部原层，49 个外部层保留。全部原前端目录、链接和文件与当前平台模板核对，两个输入全部匹配；项目上下文 16 个文件含 2 个不同文件，没有按模板共享放行。完整原结果依赖图另证明上下文仍被其他构建引用。原 equalMutable 指向已证明平台输入的不可变别名现在也保留；普通父边不获得该资格。此修正红用例 3 pass／1 fail，修正后 14 pass／0 fail、70 断言。原实际图中仅一个专属 cache／storage 134，未知输入为 0；8 个旧 result 缺少当前 cache 身份，继续为不完整，不把它们自动当成已回收。未宣称缓存已清理。原 trace 读取并核对摘要，不落盘或输出 auth header／私有属性。没有 prune／cancel／原实例重启。

集群原 Pod 保护新增 selected stop：只选择完整已确认原 Pod 范围中的 key，保存原 UID 实际停止回执，不能伪造缩小后的 grant，也不停止未选择 Pod。BuildKit 图与 selected stop 23 pass、139 断言，见 `/private/tmp/cs-rfc037-buildkit-ownership-tests-v1.log`。正式工作／缓存物理工厂尚待安装。

## 门禁与余项

本批精确 199 路径候选、外部在制路径指纹已记录。原 173 TS／TSX 精确 lint、工作台类型和结构检查通过；新增闭门回归及正式许可／缓存别名修正另做精确 lint。全仓后端类型的 v7 失败来自其他会话新增的 `nativePageRead.test.ts` 字面量类型；原日志保留，未改或提交该文件。自有 159 后端／host TS 候选的 v9／v10 类型检查已通过；既有部署测试补齐实际断言已用的 name 字段类型，运行断言保持。

上一自有完整 v6：5938 pass、143 环境 skip、1 fail，223884 断言。唯一失败是 Runner 测试伪服务器 stop 未等待实际关闭；现在返回并 await 原 server.stop，全部时限和断言保持，14 pass、75 断言。其他会话最新完整门 6030 pass、156 skip、3 fail：两个旧目录 fixture 绕过本批新锁及尚在编辑的 capability 用例；这三个失败均已补齐实际入口，原失败日志保留，不拿定向重跑称全仓绿。本批 v7 完整 check 终态 **6051 pass／156 环境 skip／1 fail、261562 断言、1211 文件、2301.28 秒**；唯一失败是旧闭门 HTTP 数量断言，已经新增真实能力关闭和删除 POST 404 回归。正式许可及平台缓存别名修订后冻结 v8；单次 v8 完整 check 在其他会话在制 `modules/session/adapters/persistence/developmentUsage.ts` 的 84 行函数 lint 处退出，未进入用例，原日志保留。按 development-rules §3，不改或收编其输出；精确 174 TS／TSX lint、160 自有后端／host 类型及工作台类型、结构通过，三处修订的正式 owner／Linux 实际 unlink、缓存图和真实 PG 闭门回归全部通过。复用 v7 未变源码的完整用例证据，以确切提交树的六项 hosted CI 作最终全仓判断，不把本地修订全仓记成绿色。

完整待验收项：正式 runtime／release 原工作与 BuildKit 缓存物理工厂、私有 Registry 独占来源和部署配置、SCM／Garage 原实例清理端口安装、完整 22 方生产组合、管理员双确认后专用原项目全资源回收。创建弹窗交付和 SDK／受控来源验证均不代替这些项目。删除控制器和入口继续 OFF，完整目标 active。
