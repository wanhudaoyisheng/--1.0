# 词钥 · 全栈应用

一个文字探索式推理游戏：从人物原话里点出可疑的字，把它指向某个人或某个世界设定，判定通过就翻出新的线索，一路拼出人物关系与世界真相。

**这一个目录就是完整的应用**——前端静态页面 + API 服务 + 数据库，单端口跑起来即可上线。

> 为什么要有后端：这是一款解谜游戏。剧本一旦随页面下发，玩家按 F12 就能看到所有关键词和结局。因此判定必须离开浏览器。

---

## 快速开始

```bash
npm install
npm start          # 默认 http://127.0.0.1:8787
```

打开 <http://127.0.0.1:8787> 就是完整游戏。首次启动会自动建表、导入剧本，不需要额外步骤。

| 命令 | 作用 |
|------|------|
| `npm start` | 生产启动（监听 `PORT`，默认 8787） |
| `npm run dev` | 带 --watch 的开发模式 |
| `npm run seed` | 手动重新导入剧本（幂等，内容没变不写新版本） |
| `npm test` | 引擎单测 + 接口集成测试（13 项） |
| `npm run typecheck` | TypeScript 类型检查 |

要求 Node ≥ 22.6。运行时直接用 Node 原生的 TS 类型擦除与内置 SQLite 执行 `.ts`，
**没有编译步骤、没有原生模块**，因此换机器不会因为 ABI 不匹配而崩。
启动命令里的两个 flag 是为此准备的：`--experimental-strip-types`、`--experimental-sqlite`。

---

## 目录结构

```
词钥-server/
├── data/scenario.js          剧本源文件（唯一一份；前端不持有任何剧本内容）
├── public/                   前端静态页面（由本服务同源托管）
│   ├── index.html            封面 + 游戏主页
│   ├── style.css             四套主题（CSS 变量）
│   ├── landing.js            封面、主题切换、迷幻背景
│   ├── api.js                唯一的网络层：后端地址解析 + 错误映射 + 重试
│   └── app.js                纯渲染客户端（只认 board，不做判定）
├── scripts/seed.ts           手动导入剧本
├── src/
│   ├── server.ts             入口：连库 → 确保剧本 → 监听 → 优雅停机
│   ├── app.ts                装配：CORS、安全头、错误处理、路由、静态托管
│   ├── config/env.ts         环境变量集中校验，缺失即启动失败
│   ├── core/                 类型化错误、id 生成
│   ├── db/                   连接（node:sqlite）、迁移、事务
│   └── modules/
│       ├── scenarios/        剧本结构校验、加载、仓储、启动自举
│       ├── judge/            判定引擎（纯函数，唯一事实源）
│       ├── guide/            演绎层模板（将来接 LLM 的降级库）
│       └── sessions/         对局：routes / service / repo
└── test/                     引擎单测 + 接口集成测试
```

分层约定：**routes 只做校验与出参，service 承载业务与事务，repo 只碰数据**。判定引擎不依赖数据库、不依赖 HTTP，所以能被单测直接调用。

---

## 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 进程存活 |
| GET | `/ready` | 依赖可用（含数据库探测） |
| GET | `/api/scenarios` | 剧本列表 |
| POST | `/api/sessions` | 开局，返回 `{ sessionId, board }` |
| GET | `/api/sessions/:id` | 拉当前盘面 |
| POST | `/api/sessions/:id/attempts` | 提交判定 `{ keyword, target }` |
| POST | `/api/sessions/:id/hints` | 取提示 `{ cardId? }`，按卡逐级递进 |
| GET | `/api/sessions/:id/replay` | 对局回放 |

提交判定的响应：

```json
{
  "verdict": "double",
  "reaction": "双杀！两条线同时亮了，这手漂亮。世界观「人型兽的分类」解锁…",
  "unlocked": [{ "id": "i005", "kind": "info", "title": "本", "text": "…", "charName": "本" }],
  "newCharacters": [],
  "milestones": [{ "id": "m2", "name": "兽影浮现", "desc": "…" }],
  "ended": false,
  "board": { "…": "最新盘面" }
}
```

错误统一为：

```json
{ "error": { "code": "SESSION_ENDED", "message": "这一局已经结束…", "details": null, "requestId": "…" } }
```

| code | 场景 |
|------|------|
| `VALIDATION_FAILED` | 入参不合规 |
| `NOT_FOUND` | 对局不存在 |
| `SESSION_ENDED` | 已通关后继续提交 |
| `RATE_LIMITED` | 每分钟提交超过 `ATTEMPT_RATE_LIMIT` |
| `INTERNAL_ERROR` | 未预期异常（堆栈只进日志） |

---

## 防剧透的边界

盘面（board）**只下发已解锁的内容**：

- 信息卡 / 世界观卡：只给已解锁的全文，不带 `lock`（关键词 / 前置 / 提示）
- 未登场人物：只给 `{ id, name: "？？？", profile: "尚未登场" }`
- 未达成里程碑：连名字都隐去（`守门人之秘` 这种名字本身就是剧透）
- 结局文本：只在 `ended = true` 后出现
- `readyTargets`：只告诉玩家「哪个人物还有话没说完」和条数，不给关键词

集成测试里有一条断言，直接检查开局响应不含 `keyword` / `requires` / `hints` 以及未解锁卡片的原文。

---

## 环境变量

见 `.env.example`，全部有可用默认值。生产环境请显式配置。

| 变量 | 默认 | 说明 |
|------|------|------|
| `PORT` | 8787 | 部署平台会注入 |
| `HOST` | `0.0.0.0` | 容器/沙箱里必须绑全网卡 |
| `DB_FILE` | `var/ciyue.db` | SQLite 文件；不可写时自动降级内存库 |
| `STATIC_DIR` | `public` | 同源托管的前端目录 |
| `CORS_ORIGINS` | 开发期 `*`，生产空 | 留空 = 只允许同源；生产禁止 `*` |
| `ATTEMPT_RATE_LIMIT` | 60 | 每会话每分钟判定上限 |
| `NODE_ENV` | development | 设为 production 会收紧 CORS 校验 |

`.env` 在 `.gitignore` 里，只提交 `.env.example`。

---

## 部署

这个应用满足「单端口 HTTP 服务」的部署模型，直接可用：

- 监听 `process.env.PORT`，绑定 `0.0.0.0`
- 依赖装好后 `npm start` 即可，无需构建
- 数据库用 Node 内置 SQLite，文件随应用目录落盘；若沙箱文件系统只读，会自动降级为内存库（站点能玩，重启丢进度），并在日志里告警
- 首次启动自动建表 + 导入剧本，不需要单独的种子步骤

---

### 关于 GitHub

- **GitHub 本身不运行代码**，它只是代码托管；能给出「可访问网址」的是它旁边的东西。
- **GitHub Pages 跑不了这个应用**：Pages 只托管静态文件，不跑 Node 进程、没有 SQLite。要硬上 Pages，就得把判定搬回浏览器，等于把答案交给玩家——这个产品的核心就没了。
- GitHub 在这里的正确用法有三个：① 源码仓库；② GitHub Actions 跑 CI（`.github/workflows/ci.yml` 已就绪，含真实启动冒烟）；③ 托管平台通过「连接 GitHub 仓库」自动部署。

### 用容器部署到支持 Node 的服务

本目录自带 `Dockerfile`，镜像里不需要编译工具链（运行时直接执行 .ts + 内置 SQLite）：

1. 平台新建服务 → 连接 GitHub 仓库
2. Root Directory 填 `词钥-server`，或用 Dockerfile 构建
3. **挂持久卷到 `/data`**（不挂也能跑，但重启后对局会丢）
4. 健康检查路径 `/health`
5. `PORT` 由平台注入；只有需要跨域访问时才设 `CORS_ORIGINS`

> 提醒：多数托管平台的免费层磁盘是临时的，SQLite 会随重启清空。要长期保留对局，得换 PostgreSQL 或确认平台提供持久卷。

## 后续要做的

1. **换 PostgreSQL**：SQL 都是标准写法，替换 `src/db/index.ts` 的驱动 + 加一份 PG 迁移即可；注意多数托管平台只给单端口，换库要同时换部署方式。
2. **换 @fastify/helmet**：现在手写了三条安全头，正式环境用插件统一管理 CSP。
3. **接真实 LLM**：`src/modules/guide/templates.ts` 就是降级模板库。接模型时在同一层做「提示词注入 + 输出白名单校验 + 超时回退」，判定仍归 `judge/engine.ts`。
4. **账号体系**：目前是游客会话（sessionId 存 localStorage，仅用于续玩，不是身份凭证）。
5. **限流换 Redis**：内存 Map 在多实例下不共享。

---

## 已知限制

- 对局数据存在 SQLite 单文件里，多实例部署需要换库或加共享存储。
- 限流是单进程内存实现，重启即清空。
- 剧本编辑靠改 `data/scenario.js` 后重跑 `npm run seed`，还没有可视化编辑器（PRD 遗留项）。
- 会话 id 就是访问凭证：知道 id 就能读那盘棋，因此前端只用它续玩，不做身份。
