# CPTSD 疗愈伴侣 · 配套服务（Node.js cron 批处理 + 管理 API）

本仓库**不是**主站对话 API。主站用户认证、聊天、日记 CRUD 均在 [safebase_front_cursor](../safebase_front_cursor)（Supabase Auth + Edge `stream-chat` + PostgREST）。

本服务连接**同一套 Supabase Postgres**（`DATABASE_URL` 直连），提供：

1. **夜间记忆批处理** — 日摘要、画像更新、锚点维护（**cron + `npm run tasks`**，无需 Redis）
2. **HTTP 管理接口** — `/api/admin/*`，供 [safebase_admin_cursor](../safebase_admin_cursor) 使用

技术栈：**Node.js 18+ · TypeScript · Fastify · pg**

## 快速开始

```bash
cp .env.example .env   # 填写 DATABASE_URL、OPENROUTER_API_KEY、ADMIN_SECRET
npm install
npm run dev            # 开发：http://0.0.0.0:8000
npm run build && npm start   # 生产
```

## 批处理（cron）

```bash
npm run tasks -- daily
npm run tasks -- profiles anchors
```

见 `scripts/cron.example`。

## 管理 API

- 鉴权：`X-Admin-Key` = `.env` 的 `ADMIN_SECRET`
- `GET /api/admin/users`
- `GET /api/admin/users/:id?messages_limit=50`

用户列表来自 **`auth.users`**（Supabase Auth）。

## 环境变量

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | Postgres 连接串（`postgresql://` 或 `postgresql+asyncpg://`） |
| `OPENROUTER_API_KEY` | 跑批处理时必填 |
| `OPENROUTER_EMBEDDING_MODEL` | 建议 `openai/text-embedding-3-large`（2048 维） |
| `ADMIN_SECRET` | 管理端密钥 |
| `PORT` | 默认 `8000` |

## 目录

```text
src/
  index.ts          Fastify 入口
  admin/routes.ts   管理 API
  tasks/index.ts    夜间批处理
  llm/openrouter.ts OpenRouter 封装
  prompts/index.ts  Prompt 模板（默认读 prompts/*.txt）
scripts/
  run-tasks.ts      cron 入口
  clear-user-data.ts
prompts/            可覆盖的内嵌模板
```

## 工具

```bash
npm run clear-data   # 清空业务表（不删 auth.users）
```

主站 Schema 由 `safebase_front_cursor/supabase/migrations/` 维护；部署前在 Supabase 执行迁移。
