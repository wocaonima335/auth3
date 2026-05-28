# auth

`auth` 是一个面向 Phase3 补 token 的本地独立仓库。

当前版本按“先可用、再深拆”的思路实现：

1. 仓库结构已经按 `web + api + worker + packages/*` 的独立项目形态搭好
2. `api` / `worker` / `web` 可以独立启动
3. 账号来源继续兼容老仓库的 `username.json`
4. Worker 当前通过兼容执行器调用老仓库的 `phase3-fetch-token`
5. token 会被复制到本仓库 `data/artifacts`，便于前端下载和审计

这意味着：

- 你现在已经有一个可单独运行的控制面仓库
- 它不是只停留在设计稿，而是能创建任务、消费任务、触发 legacy Phase3、拉回 token 产物
- 后续要继续推进时，可以逐步把 legacy CLI 执行器替换成真正的 `phase3-core` 浏览器执行链

## 目录结构

```text
auth/
├── apps/
│   ├── api/
│   ├── web/
│   └── worker/
├── packages/
│   ├── account-store/
│   ├── artifact-store/
│   ├── job-store/
│   ├── phase3-core/
│   ├── runtime-config/
│   ├── shared-types/
│   └── shared-utils/
├── data/
│   ├── artifacts/
│   └── runtime/
├── deploy/
│   └── docker-compose.yml
└── docker/
```

## 当前 MVP 做了什么

### 已实现

1. 独立仓库骨架
2. 文件兼容型账号仓储 `JsonCompatAccountRepository`
3. 文件型任务仓储 `FilePhase3JobRepository`
4. 文件型产物仓储 `FileArtifactRepository`
5. Phase3 执行协调用例 `runPhase3Job`
6. 兼容执行器 `LegacyPhase3CliExecutor`
7. API：
   - `GET /healthz`
   - `GET /api/v1/accounts/:email`
   - `GET /api/v1/phase3/jobs`
   - `POST /api/v1/phase3/jobs`
   - `GET /api/v1/phase3/jobs/:jobId`
   - `GET /api/v1/phase3/jobs/:jobId/events`
   - `GET /api/v1/phase3/jobs/:jobId/token`
   - `POST /api/v1/phase3/jobs/:jobId/retry`
8. Worker 轮询任务并执行
9. Web 控制面静态页面
10. Dockerfile 和 `docker-compose.yml`

### 仍属于后续工作

1. 真正把 `Phase3BrowserRuntime` 从老仓库中抽成独立实现
2. 接入 `postgres + redis`
3. 把任务状态与事件流切到数据库和消息队列
4. 把前端升级成 React/Vite 控制面
5. 把 worker 的兼容执行模式切到原生 `phase3-core`

## 运行方式

### 本地直接运行

打开三个终端：

```powershell
node apps/api/src/server.js
```

```powershell
node apps/worker/src/worker.js
```

```powershell
node apps/web/src/server.js
```

默认地址：

- API: `http://localhost:3000`
- Web: `http://localhost:3010`

### 环境变量

优先通过 `.env` 或系统环境变量提供这些关键配置：

- `AUTH_LEGACY_PROJECT_ROOT`
- `AUTH_USERNAME_SOURCE`
- `AUTH_LEGACY_TOKEN_DIRS`
- `AUTH_LEGACY_CONFIG_PROFILE`
- `AUTH_LEGACY_CONFIG_FILE`

如果不额外配置，默认会指向当前老仓库：

- `E:/codex-registrar2/codex-registrar2_副本`

## 兼容执行模式说明

当前 Worker 并没有直接复刻老仓库里的浏览器自动化，而是采用兼容桥接策略：

1. 收到任务后，根据邮箱在 `username.json` 中恢复上下文
2. 通过子进程调用老仓库：
   - `node index.js --stage=phase3-fetch-token --email=<email>`
3. 执行成功后，从 legacy token 目录中找到该邮箱对应的 token 文件
4. 复制到本仓库产物目录，并写入任务元数据

这种做法的价值是：

1. 新控制面仓库已经可以独立承接任务
2. 不需要在第一步就把所有浏览器自动化细节整体搬过来
3. 后续可以平滑替换执行器，而不会影响 API / Web / 任务系统

## 数据目录

仓库运行后会在 `data` 下写入：

- `data/runtime/db/accounts.json`
- `data/runtime/db/jobs/*.json`
- `data/runtime/db/events/*.json`
- `data/artifacts/<jobId>/...`

## 后续建议

如果继续推进，推荐顺序是：

1. 先验证这个兼容 MVP 路线在本机能跑通
2. 再把 `LegacyPhase3CliExecutor` 逐步替换成原生 `phase3-core`
3. 然后接入 `postgres + redis`
4. 最后再升级前端和部署链路
