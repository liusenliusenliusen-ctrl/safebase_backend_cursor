# CPTSD 疗愈伴侣 · 后端（FastAPI）

FastAPI 服务：用户认证（JWT）、流式对话、长期记忆表结构、**基于 pgvector 的 RAG**、Celery 定时任务等。  
**当前主站前端已改为 Supabase 优先**（Auth + Postgres + Edge Function 对话）；本仓库适合作为 **同一套数据库上的配套服务**：管理接口、向量写入与检索任务、或与旧客户端兼容的 HTTP API。

## 与 Supabase 的关系

- 主产品数据可托管在 **Supabase Postgres**（含 `pgvector` 扩展）。将 `DATABASE_URL` 配成 Supabase 提供的连接串（**直连数据库**角色，如迁移/服务账号，用于绕过 RLS 的后台任务）即可与前端共用数据。
- 前端仓库 [safebase_front_cursor](../safebase_front_cursor) 中的 `supabase/migrations/` 定义了 RLS、审计、`messages` / `summaries` / `anchors` 等与 RAG 相关的表；本服务若连同一库，请保持 **schema 与迁移一致**，避免与 RLS 策略冲突（应用用户请求仍应走 Supabase 客户端 + 用户 JWT）。
- **管理后台** [safebase_admin_cursor](../safebase_admin_cursor) 仍通过本服务的 `/api/admin/*` 访问用户与统计信息，需本服务启动且能访问同一数据库。

## 技术栈

- FastAPI
- PostgreSQL + **pgvector**
- SQLAlchemy 2.x（异步）
- 大模型与向量：**OpenRouter**（推荐）或 **火山方舟**
- Celery + Redis（定时摘要、画像、锚点等）

## 本地运行

1. 安装依赖：

```bash
pip install -r requirements.txt
```

2. 环境变量（`.env` 示例）：

- `DATABASE_URL`：异步连接串，例如 `postgresql+asyncpg://USER:PASS@HOST:5432/postgres`（可为 Supabase 直连；注意与池化/IPv6 限制）
- `JWT_SECRET_KEY`、`JWT_ALGORITHM`
- `ADMIN_SECRET`（可选）：与请求头 `X-Admin-Key` 一致时可访问 `/api/admin/*`

**大模型与向量（二选一）：**

- **OpenRouter**（推荐）：`OPENROUTER_API_KEY`、`OPENROUTER_CHAT_MODEL`、`OPENROUTER_EMBEDDING_MODEL`；可选 `OPENROUTER_EMBEDDING_DIMENSIONS`（如与库中向量维度一致时 `2048`）
- **火山方舟**：`ARK_API_KEY`、`ARK_CHAT_MODEL`、`ARK_EMBEDDING_MODEL`（未配置 OpenRouter 时生效）

3. 数据库：若使用 Supabase，先在前端仓库执行 `supabase db push` / `supabase start` 应用迁移；若独立 Postgres，需自行启用 `vector` 并与 `app/models.py` / 迁移对齐。

4. 启动应用：

```bash
uvicorn app.main:app --reload
```

5. Celery（可选）：

```bash
celery -A app.tasks.app worker -B
```

更多细节见代码与配置模块注释。
