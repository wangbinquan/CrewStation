# 原生业务历史逐项保留与正式清理

状态：实施及原项目验收中，实际删除和独立 AFTER 尚未通过。

实际 `00c96ac3` 已部署，六项确切 SHA CI 成功；PostgreSQL 当前基线在管理员界面完成真实 OID、角色、服务器／容器、PVC／PV 核对并保存。业务后续预检发现 RFC-027 外项目的三个取消执行及三个空闲会话卷缺少 TaskRuntime 原归属。完整7张 runtime 引用表的只读审计共39个标识，缺失4个：此前已确认的旧业务运行标识及这3个原生标识。审计原件为 `cs-rfc037-i36-business-full-source-audit-v2.jsonl`；不是历史出生或停止证明。更早完整正文导出137失败留证，不算通过。

| 缺失原运行标识 | 执行原主键 | 原完整执行摘要 | 原完整home摘要 |
| --- | --- | --- | --- |
| 01a0e263-824d-7002-b2fe-190476e6fe74 | 01a0e263-824d-7000-97a7-1d804dfdebe1 | a184cea503f7901c9f58fdc8a64cedfef52afb627d1477666d3806da2b0a531d | fb2bd3d39010c9b69d48f741a5fdf6be10cdccb96ef01e54e8f86b2afdf1b5d3 |
| 01a0e26f-da7a-7002-8e9f-9f01ae792c56 | 01a0e26f-da7a-7000-aacf-3c2b77cb4e9d | 27797d6ed292e60e3ff472efb4d47e3558884159fb2feee20840ad519150759e | 0b819a573e336f070de6a1869af6b38a17a7219357e14b98a5de09bbab08331c |
| 01a0e274-9b71-7002-a57d-3a749be3d744 | 01a0e274-9b71-7000-b00b-c661bbd4e7db | 76782911d8c3ae04ed315fb11fe23963d7b33ad6dd4c328e034231c1665a6591 | 979b7907489623bda8abf140dd2172b557eb7bb237104ed27ed1f5cfa9fa1fa0 |

原公开父任务 `01a0e263-469b-7000-9d64-d8d19e0ea1b7`、服务 `01a0e230-b5b2-7001-ab00-37dd3ba50ea4` 同属外项目 `01a0e230-b5b2-7000-aead-11379a2dc9a8`。未知原运行身份保持未知，沿已经批准 B 逐项确认完整保留，不以这些父引用补造 TaskRuntime 来源。

实现绑定每条原完整正文、全部25张原登记表中的执行／会话／卷反向关联闭包、公开 task/service 根及完整当前 Pod 来源。关联来源无法一致核对、当前目标或活跃引用、未结束／未释放执行、占用home、租约、畸形关系和读取失败均拒绝。一个批次共享关联／公开来源读取，保存和最终重读各自重新建立快照；不跨请求复用证据。界面仅导出固定核对事实及摘要，业务密文、结果或输出不进入确认记录。

业务正式 metadata 清理必须继续使用原 `context.target`，否则已确认外项目旧记录会在最终重读时再次因缺失来源被阻断。该修复保持原正文／主键数量、当前范围摘要、原消费者退出及七阶段顺序。

真实 PostgreSQL 回归覆盖六类：两条分别确认、原文保持和全部七阶段；既有legacy保留经过正式metadata；原文／当前身份／公开来源／关联变化失效；目标／活跃／未知／共享／未结束／畸形拒绝；601条前页后的cursor；字面标识匹配与实际来源读取错误。初始测试0候选复现 V3 缺口；第一轮fixture的 UNION 排序错误及后续租约fixture约束错误保留原日志，不记为业务修复通过。

待办：冻结候选相关真实PG／自有静态及新增代码防护、精确上库六CI／部署、管理员实际逐项核对六条候选、原目标22方两次确认和真实删除；追加完整业务关联独立 AFTER，并保持既有全部原始 BEFORE 和其他资源保护检查。全部通过前不得报告项目彻底回收完成。


## 冻结候选验证（2026-10-07）

原独立测试PostgreSQL ID d12386b3dccd7458ab86544934a982d03f82a6f8cbcd941f493a1c988d1d9c27保持；相关15文件45项／0失败、424断言，冻结功能文件摘要全保持，日志 `cs-rfc037-i36-business-native-repair-targeted-v1.log`。官方changed-lines/lcov判定4个生产文件122条新增可执行行、121条覆盖，99.18%，0违规。自有eslint和全局typecheck通过；arch当前7项全部指向并行observability在制品（6条domain→ports边界、1个目录大小），依development-rules §3留证范围检查，不将该全局失败称为通过，不提交这些文件，确切提交树须六CI终态成功。

实际00c96ac3 API容器、Pod UID／imageID绑定下，以强制只读连接将同一冻结候选作一次原公开owner／完整当前来源计算。19:07:38Z六条候选均retain可选、0阻断，原完整摘要与上表一致；关联闭包实际为30条，包含原执行／home及其投影、事件等完整反向引用，当前没有匹配活跃消费者／目标引用。原件 `cs-rfc037-i36-native-business-live-candidate-v2.jsonl`，仅固定事实离开业务owner；旧未缓存诊断因重复整组读取被按精确程序摘要和进程出生取消，不记为成功，平台worker和项目资源未终止。该计算不部署、不写库、不代替界面确认。

同次实际SQL确认原项目已有77份持久决定（业务1、网关23、provisioning52项retain，PostgreSQL1项reclaim），删除operation仍0。PG保存后18:44:02Z完整计划的数据和发布owner已通过，但业务仍缺上述来源，runtime-environment该次来源读取失败，原失败保留并继续诊断。原项目仍未删除。


独立源码复核另补充关联运行环境的公开原归属：即使外项目记录未含目标UUID，只要关联runtime的公开owner指向目标／冲突项目仍拒绝，且所有已知runtime原来源摘要进入确认。新增真实PG隐藏目标引用回归后，最终冻结相关15文件46项／0失败、427断言，51.92秒；4个生产文件126条新增可执行行、125条覆盖（99.21%），0防护违规。新增边界后自有lint与全局typecheck通过，功能摘要保持。最终原件为 `cs-rfc037-i36-business-native-repair-targeted-v2.json`、`cs-rfc037-i36-business-native-repair-patch-v2.json`。前一45项结果只适用于先前候选，不作为最终候选全部通过的替代。

最终冻结候选实际强制只读复核于19:16:08Z通过，六条原摘要保持、完整30条关联及全部已知runtime公开原归属一致，允许逐项retain且0阻断；候选统一关联摘要f18e070b6f30fb61371da5e0bd741cd84edeb4d8c24ebff8a62660cf6a97f793。`cs-rfc037-i36-native-business-live-candidate-v3.jsonl`。原77份确认及0删除操作保持。另以实际运行镜像owner工厂只读重核19:13:00Z完整6条资源、0阻断（`cs-rfc037-i36-runtime-environment-last-plan-diagnostic-v1.jsonl`）；先前计划该owner失败的具体原因尚未复现，不据此改写旧计划或宣称稳定性问题解决。


## 精确发布、部署及删除前独立核验（2026-10-07）

本批10个自有路径精确提交并推送 `f277e6695303bc8a4fa3486a7bb2e0ee9cbe8f02`，索引为空、远端0／0，当前54个并行在制路径未纳入。确切[CI 37517882826](https://github.com/wangbinquan/CrewStation/actions/runs/37517882826)六作业全部终态success。本机control与console镜像独立构建后部署，八组件Ready／实际Pod imageID与节点OCI源码标签均核对；256项原迁移无DDL变化，原native配置、存储和4e26探针身份保持，默认TaskRunner仍是原共享f75fd473。原件：`cs-rfc037-i36-business-native-repair-publication-v1.json`、`cs-rfc037-f277e6695303-i36-business-native-repair-exact-ci-v1.json`、`cs-rfc037-f277e6695303-i36-business-native-repair-v1-deployment-receipt.json`。

删除前另以独立静态25表SQL、完整原正文SHA、原父create-task操作、公开task／service／全部已知runtime端口和集群完整Pod／PVC／PV清单核对通过：30条关联、原六行摘要保持，无匹配Pod；外项目原PVC与PV各1个。完整原父任务的9条native执行另全部留作对照。原件 `cs-rfc037-i36-native-business-independent-before-v1.json`；从早期原始BEFORE接续，均未覆盖。actual00的release和runtime-environment来源连续两轮分别15／6资源、0阻断；`cs-rfc037-i36-native-owner-sequential-diagnostic-v2.jsonl`，先前来源失败未复现，不把独立检查代替当前全22方计划。

19:54Z从管理员长列表末行打开同一原目标，f277版本完整盘点在途。剩余六项界面确认、两层确认实际删除及全部独立AFTER尚未通过，RFC继续实施中。
