# RFC-035｜对象备份与恢复操作

本流程由有数据库管理权限的运维显式执行；不是定时备份服务。备份范围是 CS 平台 PG 和已发布对象，包括有效引用／归档收据。业务应用自己的 PG、尚未归档的任务卷、原生会话及外部密钥另行保存。工作台不能把本流程成功解释为整个 AW 工作流可恢复。

## 导出

准备独立故障域的目录，且最终输出子目录尚不存在。通过受保护的运维环境提供 `CS_DATABASE_URL` 和 `CS_SECRET_KEY`；不要放入命令参数、终端历史或报告。`CS_PG_DUMP` 可指定 PostgreSQL 17 或兼容版本的 `pg_dump` 可执行文件。数据库身份保护读取 `pg_control_system()` 和当前库 OID，权限不足会失败，不降级为猜测。

在仓库根目录按顺序执行，尖括号内容由运维填入：

```sh
bun deploy/local/object-storage/backup.ts begin '<稳定请求键>' '<独立目的地名称>' '<备份原因>'
bun deploy/local/object-storage/backup.ts status '<返回的备份ID>'
bun deploy/local/object-storage/backup.ts export '<备份ID>' '/独立目的地/全新子目录'
bun deploy/local/object-storage/backup.ts verify '/独立目的地/全新子目录' '<返回的manifestDigest>'
```

`begin` 持久冻结全部对象后端的新写入、引用变更、收据及新删除许可。`status` 为 draining 时先排空真实在途写入与删除；未知写者、未知删除结果不会因超时消失。`export` 只从 frozen 开始，一次只有一个执行者。先生成一致 PG 自定义格式快照，再分页串行导出对象；每份副本读回核对长度和 SHA-256，最后封存索引及总清单。仅全部步骤通过才记录 succeeded 并解除本次冻结。目录／文件为 0700／0600，已有目录和符号链接拒绝复用。

同键重放只返回原备份，不重复创建。断线后先读 `status`；已经 succeeded 时使用原清单。可观察到的失败会留下 failed 记录且不更新最近成功时间；进程直接消失会保留 exporting 和冻结。运维确认原进程不再使用该输出后，可执行 `abort '<备份ID>'`，再以新键和新目录重做；未封存副本不得用于恢复。abort 不解除其他迁移／任务屏障，不删除原对象。

## 隔离恢复验证

1. 选择与原库不同的独立空库及独立空对象后端；目标与原平台、旧业务数据面、K8s 写端点保持隔离，控制器和业务进程不启动。先用已保存的 `manifestDigest` 校验整个副本。
2. 使用 `pg_restore --single-transaction --exit-on-error --no-owner --no-privileges` 将 `platform.pgdump` 恢复到空库。连接凭据经环境注入。不得对现有库使用 `--clean`、覆盖或局部合并来制造一次“成功恢复”。PG 自定义格式快照的说明见 [pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html) 和 [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html)。
3. 为每个原后端准备独立的目标桶和限定桶读写凭据，将以下数组写入权限 0600 的普通 JSON 文件；不把真实凭据放进命令参数。后端编号取备份所恢复的元数据，必须恰好覆盖全部原后端。

```json
[{"backendId":"<原后端UUID>","endpoint":"https://<独立目标端点>","region":"garage","bucket":"<独立目标桶>","accessKeyId":"<目标访问键>","secretAccessKey":"<目标私钥>"}]
```

4. 将 `CS_DATABASE_URL` 指向隔离恢复库，`CS_SECRET_KEY` 使用能解密备份中原后端配置的密钥，运行：

```sh
bun deploy/local/object-storage/restore.ts '/独立目的地/备份目录' '<manifestDigest>' '<稳定恢复请求键>' '/私有目录/destinations.json'
```

工具拒绝原数据库和原 endpoint／bucket 组合，先校验完整备份，再持久记录目标位置修订及加密凭据。每个对象写入恢复专用、含原 ID 和摘要的新 key，完整读回比对，最后核对恢复库与备份清单的每个对象及总数。断线、摘要错误或目标不可用保持冻结；原样重跑同一键及目的地仅重传同样字节，不能替换内容或目标。原库的对象及元数据不修改。

5. 全部验证通过后，一个 PG 事务保留原 objectId、引用、收据，切换对象物理位置，重算容量并记录 `restored`。原来尚未发布的暂存上传在隔离目标中作废；已排队删除的对象不复活。仅解除本次备份冻结，其他冻结保持。只运行 `verify-restored` 的路径仍记录 `restore-verified` 且保持冻结，不能代替正式恢复。
6. 恢复后端一律重新降为 `dev-only`、清除生产耐久验证和物理容量观测；目的地不能继承原部署的耐久承诺。重新验证部署形态、权限和观测，再按既有流程开放生产能力。旧任务卷、业务数据库、原生会话与原集群控制权不在本工具恢复范围，确认它们的独立恢复／处置方案之前不要启动控制器或接入旧集群写端点。

真实隔离演练已覆盖 PG dump/restore、另一个 Garage 的正式位置切换、同键重放、原位置不变、引用／摘要与损坏拒绝。它证明 CS 已归档对象可恢复，不证明尚在执行的 AW 任务可以续跑。

## 可观测范围

管理员后端详情显示最近备份状态、目的地名称、原因、开始／更新时间、已验证对象数／字节、最近成功备份和恢复验证时间。失败不会覆盖上次成功时间；无记录显示未知／未执行。项目页仅返回授权空间及最近成功备份时间，不泄露其他项目数量或运维说明。打开页面只查询数据库和指标，不触发导出、校验、清理或解除冻结。
