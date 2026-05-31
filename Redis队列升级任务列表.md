# Redis 队列升级任务列表

更新时间：`2026-05-31`

## 1. 文档定位

这份文档用于把 [Redis队列升级设计](E:/auth/Redis队列升级设计.md) 落成可执行任务清单，供后续直接按任务顺序实现。

当前范围限定为：

1. 升级 `E:\auth` 的任务投递与消费
2. 保留现有文件型 `job-store`、`artifact-store`
3. 不在本轮迁移 Postgres
4. 不重写 Phase3 执行核心

---

## 2. 总目标

本轮升级需要交付 6 个结果：

1. 引入 Redis 作为真正的任务队列
2. API 创建任务后写文件并入 Redis
3. Worker 通过 Redis 阻塞消费任务
4. 保留现有任务文件与事件落盘
5. 支持多 Worker 不重复消费同一任务
6. 补齐启动恢复与最小验证链路

---

## 3. 实施顺序总览

建议按以下顺序推进：

1. Task 1：补运行配置
2. Task 2：新增 Redis 队列抽象
3. Task 3：改 API 入队
4. Task 4：改 Worker 消费
5. Task 5：补取消、重试与恢复
6. Task 6：更新 Docker 和 README
7. Task 7：补最小验证

---

## 4. 任务拆分

## Task 1. 补运行配置

目标：

- 让 API 和 Worker 可以读取 Redis 相关配置

涉及文件：

- `packages/runtime-config/index.js`
- `.env.example`

子任务：

1. 增加 `AUTH_REDIS_URL`
2. 增加 `AUTH_REDIS_ENABLED`
3. 增加 `AUTH_REDIS_QUEUE_PENDING_KEY`
4. 增加 `AUTH_REDIS_QUEUE_PROCESSING_KEY`
5. 增加 `AUTH_REDIS_QUEUE_DEAD_KEY`
6. 增加 `AUTH_REDIS_BLOCKING_TIMEOUT_SEC`

验收标准：

- 本地配置对象能完整提供 Redis 队列所需参数

## Task 2. 新增 queue-store 包

目标：

- 增加一个独立的 Redis 队列抽象层

建议新增目录：

```text
packages/queue-store/
  index.js
  RedisPhase3Queue.js
```

子任务：

1. 初始化 Redis 客户端
2. 实现 `enqueue(jobId)`
3. 实现 `dequeue(workerId)`
4. 实现 `ack(jobId)`
5. 实现 `removePending(jobId)`
6. 实现 `moveToDead(jobId, reason)`
7. 实现 `recoverStaleProcessingJobs()`

验收标准：

- API 和 Worker 可以通过同一抽象访问 Redis 队列

## Task 3. 改造 API 创建任务逻辑

目标：

- API 创建任务后不再只写文件，还要立即入队

涉及文件：

- `apps/api/src/server.js`

子任务：

1. 在创建任务成功后调用 `queue.enqueue(jobId)`
2. enqueue 失败时返回明确错误
3. 对失败情况写入任务事件
4. 保持现有 guest/admin 鉴权逻辑不变

验收标准：

- 新任务创建后可在 Redis pending 队列中看到对应 jobId

## Task 4. 改造 Worker 消费模型

目标：

- 从文件轮询切换为 Redis 阻塞消费

涉及文件：

- `apps/worker/src/worker.js`

子任务：

1. 去掉当前 `sleep(workerPollMs)` 驱动的领取逻辑
2. 改为 `queue.dequeue(workerId)`
3. 领取后根据 jobId 读取任务文件
4. 执行 `runPhase3Job(...)`
5. 结束后调用 `queue.ack(jobId)`

验收标准：

- Worker 在没有任务时阻塞等待
- 有任务时能立即消费

## Task 5. 补取消、重试和恢复

目标：

- 让 Redis 队列在真实运行中可维护

涉及文件：

- `apps/api/src/server.js`
- `apps/worker/src/worker.js`
- `packages/queue-store/RedisPhase3Queue.js`

子任务：

1. 取消 queued 任务时尝试从 `pending` 移除
2. 重试任务时创建新 job 并重新入队
3. Worker 启动时执行 `recoverStaleProcessingJobs()`
4. 终态任务不应残留在 `processing`

验收标准：

- 队列不会因为 worker 崩溃而永久卡住旧任务

## Task 6. 更新部署与文档

目标：

- 让 Redis 升级可被本地和 Docker 环境使用

涉及文件：

- `deploy/docker-compose.yml`
- `README.md`
- `.env.example`

子任务：

1. 在 compose 中增加 `redis` 服务
2. 给 `api` 和 `worker` 注入 `AUTH_REDIS_URL`
3. 更新 README 的启动说明
4. 更新 README 中“当前 MVP 做了什么”

验收标准：

- 新环境按文档可启动 Redis + API + Worker + Web

## Task 7. 最小验证

目标：

- 确保 Redis 队列升级后至少具备最小可信度

子任务：

1. 语法检查新增与修改文件
2. 创建一条任务，确认进入 Redis pending
3. 启动 Worker，确认任务被消费
4. 启动两个 Worker，确认同一任务不会重复执行
5. 人工中断 Worker，验证 processing 恢复逻辑

验收标准：

- Redis 队列升级后的主链路可跑通

---

## 5. 建议实施顺序

推荐严格按下面顺序执行：

1. 先补配置
2. 再建 queue-store
3. 先改 API 入队
4. 再改 Worker 消费
5. 再补取消、重试、恢复
6. 最后改 compose 和 README

原因：

1. 先有配置和抽象，API/Worker 才能统一接 Redis
2. 先改 API 再改 Worker，可以先验证入队行为
3. 恢复逻辑应该在消费主链跑通后再补，不然调试成本高

---

## 6. MVP 范围

如果只做第一轮最小可用版本，建议把范围控制在：

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 6 的 compose 最小更新
6. Task 7 的基本验证

MVP 暂不强求：

1. 死信队列完整运营
2. 心跳超时回收
3. 任务优先级
4. Dashboard

---

## 7. 完成定义

满足以下条件时，可认为本轮 Redis 队列升级完成：

1. API 创建任务后，jobId 会写入 Redis pending 队列
2. Worker 不再扫描文件目录领取任务
3. Worker 能阻塞等待并消费 Redis 队列
4. 任务状态和事件仍然正常写入文件 job-store
5. 多 Worker 不会重复执行同一条任务
6. Docker Compose 可带 Redis 一起启动

---

## 8. 下一步建议

如果你下一步继续让我实现，最合理的起手顺序是：

1. 先做 `Task 1 + Task 2`
2. 然后做 `Task 3 + Task 4`
3. 最后补 `Task 5 + Task 6 + Task 7`

这样可以快速把当前“文件轮询领取”换成真正的 Redis 队列主链。

