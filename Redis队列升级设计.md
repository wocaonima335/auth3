# Redis 队列升级设计

更新时间：`2026-05-31`

## 1. 文档定位

这份文档用于说明 `E:\auth` 当前任务系统从“文件轮询领取”升级到“Redis 队列驱动”的目标架构、边界、迁移路径和关键设计取舍。

当前仓库已经具备：

1. `api` 创建 Phase3 任务
2. `worker` 单进程消费任务
3. `job-store` 以文件方式保存任务元数据和事件
4. `artifact-store` 保存 token 等产物
5. `LegacyPhase3CliExecutor` 兼容调用老仓库 `phase3-fetch-token`

因此本次升级不是重写整套系统，而是把“任务投递与领取”这一层替换成 Redis。

---

## 2. 现状问题

### 2.1 当前任务模型

当前项目的任务行为大致如下：

1. API 调用 `createJob(...)`，把任务写入 `data/runtime/db/jobs/<jobId>.json`
2. 任务初始状态为 `queued`
3. Worker 轮询 `reserveNextQueuedJob(workerId)`
4. 从所有任务文件中找出第一条 `queued` 任务
5. 把状态改成 `validating`
6. 继续执行 Phase3

### 2.2 当前方案的核心问题

#### 问题一：不是真正的消息队列

虽然当前有“排队”效果，但本质上只是：

- 文件落盘
- Worker 定时扫描
- 把第一条 `queued` 改成 `validating`

这不属于可靠消息队列。

#### 问题二：多 Worker 下存在抢占竞争

如果未来启动多个 Worker，当前流程：

1. Worker A 读到 job X 为 `queued`
2. Worker B 也读到 job X 为 `queued`
3. 两边都尝试更新状态

理论上会出现同一任务被重复领取的竞态。

#### 问题三：延迟高

当前 Worker 通过 `workerPollMs` 轮询，意味着：

- 任务不是实时消费
- 峰值提交时延迟不稳定

#### 问题四：没有队列级别能力

当前方案缺少这些能力：

1. 阻塞消费
2. in-flight 跟踪
3. 崩溃恢复
4. 重试退避
5. 死信隔离
6. 多消费者协调

---

## 3. 升级目标

本次 Redis 升级的目标不是一步到位上复杂调度，而是先把最核心的队列能力补齐。

### 3.1 目标

1. API 创建任务时直接推入 Redis 队列
2. Worker 通过 Redis 阻塞消费，不再文件轮询
3. 保留文件型 `job-store` 作为任务元数据真相源
4. 支持至少 1 个以上 Worker 安全并发消费
5. 引入 in-flight 队列，便于崩溃恢复
6. 保持对当前 `LegacyPhase3CliExecutor` 的兼容

### 3.2 非目标

第一阶段不做这些事情：

1. 不迁移到 Postgres
2. 不重写 job-store 为数据库
3. 不实现完整优先级队列
4. 不实现复杂租户隔离
5. 不重写前端任务展示逻辑

---

## 4. 推荐架构

## 4.1 核心思路

推荐采用：

**Redis 负责队列投递与消费，文件 job-store 继续负责任务详情和事件落盘。**

也就是说：

- Redis 解决“谁先消费、如何阻塞等待、如何恢复”
- 文件继续解决“任务详情、事件、产物路径和兼容现有本地运行模式”

### 4.2 架构分层

```text
前端
  -> API
      -> FilePhase3JobRepository 写任务元数据
      -> RedisPhase3Queue enqueue(jobId)
  -> Worker
      -> RedisPhase3Queue consume()
      -> FilePhase3JobRepository 读取任务详情
      -> runPhase3Job(...)
      -> FilePhase3JobRepository 更新状态/事件
      -> RedisPhase3Queue ack(jobId)
```

---

## 5. 队列设计

## 5.1 队列对象

建议新增：

- `packages/queue-store/RedisPhase3Queue.js`

职责：

1. 入队
2. 阻塞领取
3. 处理中确认
4. 处理中恢复
5. 死信转移

## 5.2 Redis Key 设计

建议第一版使用以下 key：

1. `auth:phase3:jobs:pending`
   - 主待处理队列
   - 存 `jobId`

2. `auth:phase3:jobs:processing`
   - 处理中队列
   - 存 `jobId`

3. `auth:phase3:jobs:dead`
   - 死信队列
   - 存 `jobId`

4. `auth:phase3:jobs:locks:<jobId>`
   - 可选锁 key
   - 用于补强多 Worker 唯一执行

5. `auth:phase3:jobs:heartbeat:<jobId>`
   - 可选心跳 key
   - 用于恢复卡死任务

## 5.3 入队策略

API 创建任务后：

1. 先写任务文件，状态 `queued`
2. 再向 `pending` 队列 `RPUSH jobId`

这样可以保证：

- Redis 中出现的 jobId 一定有对应元数据

## 5.4 消费策略

Worker 建议用阻塞弹出：

1. `BLMOVE pending -> processing RIGHT LEFT timeout`
2. 拿到 `jobId`
3. 读取任务文件
4. 把任务状态更新为 `validating`
5. 执行 `runPhase3Job(...)`
6. 成功或失败后从 `processing` 中删除该 `jobId`

这样有两个好处：

1. 不再轮询文件目录
2. Worker 崩溃时，未 ack 的任务还留在 `processing`

## 5.5 ack 策略

Worker 成功或失败结束任务后：

1. 从 `processing` 中移除 jobId
2. 任务状态由 job-store 负责变成 `succeeded / failed / canceled`

注意：

- ack 只代表“Redis 队列处理结束”
- 业务成功与否仍由任务状态字段表达

---

## 6. 任务状态与 Redis 的关系

需要明确：

- Redis 队列状态
- 任务文件业务状态

不是一回事。

### 6.1 Redis 侧

Redis 只关心任务流转位置：

1. `pending`
2. `processing`
3. `dead`

### 6.2 任务文件侧

任务文件继续维持当前业务状态机：

1. `queued`
2. `validating`
3. `starting_browser`
4. `authorizing`
5. `waiting_email_code`
6. `exchanging_token`
7. `persisting_artifacts`
8. `succeeded`
9. `failed`
10. `canceled`

结论：

- Redis 解决“排队与消费”
- job 文件解决“业务执行阶段”

---

## 7. 取消与重试设计

## 7.1 取消

当前项目已支持取消任务状态，但在 Redis 模式下要分场景处理。

### queued 阶段

如果任务还在 `pending`：

1. 标记任务为 `canceled`
2. 尽量从 `pending` 中删除该 jobId

### processing 阶段

如果任务已被 Worker 领取：

1. 标记任务为 `canceled`
2. Worker 在执行循环里通过 `isCanceled()` 感知
3. 业务尽早结束
4. Worker 最终执行 ack

## 7.2 重试

重试仍沿用当前策略：

1. 生成新 job
2. `retryOf = oldJobId`
3. 写入 job 文件
4. 再 push 进 Redis `pending`

---

## 8. 崩溃恢复设计

Redis 队列最大的价值之一，就是可以处理 worker 崩溃。

## 8.1 处理中的任务残留

如果 Worker 崩了：

- jobId 可能残留在 `processing`
- 任务文件状态可能停在 `validating` 或中间步骤

## 8.2 第一阶段恢复策略

建议增加一个恢复方法：

- `recoverStaleProcessingJobs()`

启动 Worker 时执行：

1. 扫描 `processing` 列表
2. 对每个 jobId 读取任务文件
3. 如果任务已是终态：
   - 从 `processing` 删除
4. 如果任务不是终态：
   - 回退状态为 `queued` 或保留原状态并重新推入 `pending`

第一版建议简单些：

1. 只要 `processing` 中的 job 文件不是终态
2. 就记录一条恢复事件
3. 重新入 `pending`
4. 再从 `processing` 删除

---

## 9. 多 Worker 支持

## 9.1 当前目标

Redis 升级后的第一阶段，应至少保证：

- 可以安全启动多个 Worker
- 不会重复消费同一条任务

## 9.2 保障方式

依赖两层机制：

1. Redis `BLMOVE` / `processing` 队列
2. 可选 jobId 锁

如果 Redis 客户端和命令语义稳定，第一版可先不加单独分布式锁，只用：

- `pending -> processing` 原子移动

这通常已经足够避免双消费。

---

## 10. 代码改造点

## 10.1 运行配置

建议在 `packages/runtime-config/index.js` 中新增：

1. `redisUrl`
2. `redisQueuePendingKey`
3. `redisQueueProcessingKey`
4. `redisQueueDeadKey`
5. `redisBlockingTimeoutSec`
6. `redisEnabled`

## 10.2 新增 queue-store 包

建议新增：

```text
packages/
  queue-store/
    index.js
    RedisPhase3Queue.js
```

接口建议：

1. `enqueue(jobId)`
2. `dequeue(workerId)`
3. `ack(jobId)`
4. `moveToDead(jobId, reason)`
5. `removePending(jobId)`
6. `recoverStaleProcessingJobs()`

## 10.3 API 改造

在 `apps/api/src/server.js` 中：

1. 创建任务后调用 `queue.enqueue(jobId)`
2. 取消任务时，如果是 `queued` 状态，尝试从 `pending` 中移除
3. 保留现有文件 job-store 逻辑

## 10.4 Worker 改造

在 `apps/worker/src/worker.js` 中：

1. 移除基于 `sleep(workerPollMs)` 的文件轮询逻辑
2. 改为阻塞 `dequeue()`
3. 启动时执行 `recoverStaleProcessingJobs()`
4. 任务结束后 `ack()`

## 10.5 job-store 保持最小改动

`packages/job-store/index.js` 继续负责：

1. 创建任务文件
2. 更新状态
3. 写事件
4. 查询任务详情

不需要在第一阶段把它迁移到 Redis。

---

## 11. 部署设计

## 11.1 本地开发

本地开发增加 Redis：

1. 直接安装本地 Redis
2. 或使用 Docker 启一个 Redis 容器

## 11.2 Docker Compose

建议更新 `deploy/docker-compose.yml`：

新增：

```yaml
redis:
  image: redis:7-alpine
  ports:
    - "6379:6379"
```

并给 `api`、`worker` 注入：

- `AUTH_REDIS_URL=redis://redis:6379`

---

## 12. 迁移路径

## 阶段 1

引入 Redis 队列，但保留文件 job-store。

结果：

- 元数据仍在文件
- 投递和消费改成 Redis

## 阶段 2

增强崩溃恢复、死信和监控。

## 阶段 3

如果需要，再把 job 元数据迁移到 Postgres。

---

## 13. 风险与注意事项

### 风险一：Redis 有状态依赖

引入 Redis 后，系统比纯文件模式多一个依赖。

对策：

1. 明确本地启动说明
2. Compose 默认带 Redis

### 风险二：文件与 Redis 状态短时不一致

例如：

1. 任务文件已写入
2. Redis enqueue 失败

对策：

1. API 返回错误
2. 记录 enqueue 失败事件
3. 提供后台补偿脚本扫描 `queued` 且未入队的任务

### 风险三：processing 残留

Worker 崩溃后 `processing` 中会残留 jobId。

对策：

1. Worker 启动恢复
2. 后续可加心跳与超时回收

---

## 14. 推荐结论

对于当前 `E:\auth` 仓库，最合理的升级方式是：

1. 保留文件 job-store 和 artifact-store
2. 新增 `queue-store` 包
3. 用 Redis 替换“文件轮询领取”
4. API 负责入队
5. Worker 负责阻塞消费和 ack

这样改动最小，但收益最大：

1. 可支撑多用户并发提交
2. 可支撑多个 Worker
3. 消费延迟显著降低
4. 后续继续接入数据库也更顺

---

## 15. 一句话总结

这次 Redis 升级的本质，不是把 `auth` 全部重写成新系统，而是：

**把当前“任务元数据存文件、Worker 轮询文件目录”的模型，升级为“任务元数据仍存文件，但任务投递与消费由 Redis 保证”的混合队列架构。**

