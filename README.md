# CPTSD 疗愈伴侣 · 配套服务（Celery + 管理 API）

本仓库**不是**主站对话 API。主站用户认证、聊天、日记 CRUD 均在 [safebase_front_cursor](../safebase_front_cursor)（Supabase Auth + Edge `stream-chat` + PostgREST）。

本服务连接**同一套 Supabase Postgres**（`DATABASE_URL` 直连，通常 bypass RLS），提供：

1. **Celery 定时任务** — 日摘要、画像更新、锚点维护  
2. **HTTP 管理接口** — `/api/admin/*`，供 [safebase_admin_cursor](../safebase_admin_cursor) 使用  

已移除的 HTTP 路由（勿再依赖）：`/api/auth`、`/api/chat`、`/api/messages`、`/api/diary`。

## 在整体架构中的位置

```text
主站 daytime:
  用户 → messages / diaries (RLS) → stream-chat → OpenRouter

本仓库 nighttime / ops:
  Celery → 读 messages + diaries
         → 写 summaries, profiles, anchors
  Admin  → 读 auth.users + 业务表统计
```

## 提供的模块

| 路径 | 作用 |
|------|------|
| `app/tasks.py` | Celery 任务定义 |
| `app/llm.py` | OpenRouter 对话流式与 embedding |
| `app/prompting.py` | Prompt 模板加载（默认内嵌 + 可选 `prompts/*.txt`） |
| `app/routers_admin.py` | `GET /api/admin/users`、`GET /api/admin/users/{id}` |
| `app/main.py` | 仅注册 admin 路由 |
| `prompts/*.txt` | `daily_summary`、`profile_update`、`anchor_*` 等 |

### Celery 任务

| 任务名 | 函数 | 建议调度 | 输入 | 输出 |
|--------|------|----------|------|------|
| `daily` | `generate_daily_summaries` | 如每日 23:30 | 昨日 `messages` + 昨日更新 `diaries` | `summaries`（`type=daily`） |
| `profiles` | `update_profiles` | 如 0:10 | 近 7 条日摘要 + 近 50 条 `messages` + 近 5 篇 `diaries` | 更新 `profiles.content` |
| `anchors` | `maintain_anchors` | 如 0:30 | 新 `messages`、日摘要、日记 | 更新/新增 `anchors` |

用户范围：`profiles.user_id` ∪ `messages.user_id`（**不再**扫描已废弃的 `public.users`）。

本地不启 Redis 时，可用同步脚本调试：

```bash
python scripts/run_task_sync.py daily
python scripts/run_task_sync.py profiles anchors
```

### 管理 API

- 鉴权：请求头 `X-Admin-Key` 与 `.env` 中 `ADMIN_SECRET` 一致  
- 用户列表/详情：SQL 查询 **`auth.users`**，统计 `messages` / `summaries` / `anchors` 数量；详情含 `profiles` 与最近 `messages`  

**不需要** `OPENROUTER_API_KEY` 才能启动 `uvicorn`；但跑 Celery 任务时必填。

## 环境变量

复制 `.env.example` → `.env`：

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | **必填**。异步连接串，指向 Supabase 本地 DB 示例：`postgresql+asyncpg://postgres:postgres@127.0.0.1:54322/postgres` |
| `OPENROUTER_API_KEY` | Celery / embedding **必填**（跑任务时） |
| `OPENROUTER_CHAT_MODEL` | 默认 `deepseek/deepseek-chat` |
| `OPENROUTER_EMBEDDING_MODEL` | 默认 `openai/text-embedding-3-small` |
| `OPENROUTER_EMBEDDING_DIMENSIONS` | 与库中 `vector(2048)` 一致时填 `2048` |
| `ADMIN_SECRET` | 管理端密钥 |
| `PROMPT_TEMPLATE_DIR` | 可选，指向 `prompts/` 目录覆盖内嵌模板 |

连通性自检：`python scripts/test_openrouter_api.py`

## 本地运行

### 前置：主站迁移已应用

在 `safebase_front_cursor` 目录：

```bash
supabase start
supabase db reset   # 或 migration up
```

### 安装与启动 API

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Celery（需 Redis）

```bash
# 默认 redis://localhost:6379
celery -A app.tasks.app worker -l info -B
```

`-B` 启用 beat 调度；生产环境请配置具体 crontab（代码内为任务函数，调度表按部署约定）。

### 管理前端

```bash
cd ../safebase_admin_cursor && npm install && npm run dev
```

管理端 Vite 将 `/api` 代理到 `http://127.0.0.1:8000`。

## 数据库约定

- **Schema 来源**：仅由主站 `supabase/migrations/` 维护；本仓库 `app/models.py` 与之对齐，但**不会**在启动时创建 `public.users` 等已废弃表。  
- **外键**：库表 `user_id` 指向 `auth.users`；ORM 模型仅映射列，不依赖 `users` 表。  
- **日记表**：Celery 读 **`public.diaries`**，不是 `diary_entries`（已 drop）。  

## 工具脚本

| 脚本 | 说明 |
|------|------|
| `scripts/run_task_sync.py` | 同步执行 `daily` / `profiles` / `anchors` |
| `scripts/clear_user_data.py` | 清空 anchors、summaries、messages、diaries，重置 profiles；**不删** `auth.users` |
| `scripts/test_openrouter_api.py` | OpenRouter 连通测试 |

## 技术栈

- FastAPI  
- SQLAlchemy 2（async）+ asyncpg  
- pgvector（`summaries` / `anchors` / `messages.embedding`）  
- Celery + Redis  
- OpenRouter（对话与向量唯一网关）  

## 与主站 Prompt 的关系

- **对话 prompt**（北极星 + RAG）：在 Edge `stream-chat/prompt.ts`，不在本仓库。  
- **批处理 prompt**：本仓库 `prompts/*.txt`，由 `render_prompt()` 加载；Celery 任务变量含 `diaries_text`（读 `diaries` 表）。  

## 部署提示

- `DATABASE_URL` 使用 Supabase **直连**或具备读写业务表权限的角色；服务角色可绕过 RLS，**严禁**暴露到浏览器。  
- 主站 Edge Secrets 与后端 `.env` 的 OpenRouter 配置相互独立，需分别配置。  
